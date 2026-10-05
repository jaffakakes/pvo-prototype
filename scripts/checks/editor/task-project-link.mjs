import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createTask } from "../../../packages/pvo-assistant/tasks/index.js";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
});
const reference = {
  ownerId: "owner-one",
  projectId: "server-one",
  taskId: "task-one",
};
const task = createTask(
  {
    operationId: "create-one",
    projectId: reference.projectId,
    request: "Create an RSVP",
    examples: [],
    context: { fingerprint: "fixture-project", components: [] },
  },
  {
    id: reference.taskId,
    ownerId: reference.ownerId,
    now: Date.now(),
    inputDigest: "a".repeat(64),
  },
);

async function installProbe(page) {
  await page.evaluate(async () => {
    const { getProjectStorageStatus } =
      await import("/src/app/projectAutosave.ts");
    const { useCapture } = await import("/src/state/captureStore.ts");
    window.taskProjectProbe = { getProjectStorageStatus, useCapture };
  });
}

async function ready(page, id) {
  await installProbe(page);
  await page.waitForFunction((expected) => {
    const { getProjectStorageStatus, useCapture } = window.taskProjectProbe;
    return (
      getProjectStorageStatus().phase === "ready" &&
      (!expected || useCapture.getState().localId === expected)
    );
  }, id);
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { currentTaskReference } =
      await import("/src/state/assistant/taskProjectCommands.ts");
    const state = useCapture.getState();
    return {
      localId: state.localId,
      name: state.projectName,
      reference: currentTaskReference(),
      links: state.assistantTaskLinks,
      media: state.clips[0]?.url
        ? Array.from(
            new Uint8Array(
              await (await fetch(state.clips[0].url)).arrayBuffer(),
            ),
          )
        : [],
    };
  });
}

async function checkpoint(page, id) {
  return page.evaluate(async (localId) => {
    const { openProjectDatabase, readProjectCheckpoint } =
      await import("/src/infrastructure/projectPersistence/indexedDb.ts");
    const db = await openProjectDatabase();
    try {
      return await readProjectCheckpoint(db, localId);
    } finally {
      db.close();
    }
  }, id);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  let owner = "owner-one";
  const errors = [];
  const writes = [];
  await context.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        available: true,
        user: owner ? { id: owner, name: owner } : null,
        clerkAvailable: false,
        clerkPublishableKey: null,
        canLinkEmail: false,
        emailLinked: false,
      },
    }),
  );
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  await context.route("**/task-link-fixture.mp4", (route) =>
    route.fulfill({ contentType: "video/mp4", body: media }),
  );
  await installAssistantAvailabilityFixture(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/"))
      writes.push(request.url());
  });
  await page.goto(editorUrl);
  await ready(page);
  const originalId = await page.evaluate(async () => {
    const { createProject } =
      await import("/src/features/create-project/projectCommands.ts");
    const { mkClip, useCapture } = await import("/src/store.ts");
    const { refreshAccountSession } =
      await import("/src/state/auth/authGateStore.ts");
    await refreshAccountSession();
    const blob = await (await fetch("/task-link-fixture.mp4")).blob();
    await createProject({
      name: "Linked edit",
      ratio: "9:16",
      clips: [mkClip(3, URL.createObjectURL(blob), 0)],
    });
    return useCapture.getState().localId;
  });
  await page.evaluate(async (savedTask) => {
    const { beginTaskLinkRequest, linkSavedTask } =
      await import("/src/state/assistant/taskProjectCommands.ts");
    linkSavedTask(beginTaskLinkRequest(), savedTask);
  }, task);
  // No forced flush: a link-only change must trigger the normal debounced save.
  await page.waitForFunction(
    () => !window.taskProjectProbe.getProjectStorageStatus().storage.dirty,
  );
  assert.deepEqual(
    (await checkpoint(page, originalId)).assistantTaskLinks.accounts,
    [reference],
  );
  await page.reload();
  await ready(page, originalId);
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  let view = await snapshot(page);
  assert.deepEqual(view.reference, reference);
  assert.deepEqual(Buffer.from(view.media), media);
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().patch({ projectName: "Renamed edit" });
    useCapture.getState().edit({ ratio: "1:1" });
    useCapture.getState().undo();
    await (
      await import("/src/app/projectAutosave.ts")
    ).saveProjectBeforeUpdate();
  });
  assert.deepEqual((await snapshot(page)).reference, reference);

  const copyId = await page.evaluate(async (sourceId) => {
    const { copySavedProject } =
      await import("/src/infrastructure/projectPersistence/copyProject.ts");
    const id = crypto.randomUUID();
    await copySavedProject(sourceId, id, "Copied edit");
    return id;
  }, originalId);
  const copyUrl = new URL(editorUrl);
  copyUrl.searchParams.set("project", copyId);
  await page.goto(copyUrl.href);
  await ready(page, copyId);
  view = await snapshot(page);
  assert.equal(view.reference, null);
  assert.equal(view.links, null);
  assert.deepEqual(Buffer.from(view.media), media);
  const copyError = await page.evaluate(
    async (ids) => {
      try {
        await (
          await import("/src/infrastructure/projectPersistence/copyProject.ts")
        ).copySavedProject(ids.original, ids.copy, "Overwrite");
      } catch (error) {
        return error.message;
      }
    },
    { original: originalId, copy: copyId },
  );
  assert.match(copyError, /already exists/);
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(
      async (id) =>
        (await import("/src/app/navigation.ts")).navigateProject(id),
      originalId,
    ),
  ]);
  await ready(page, originalId);
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  assert.deepEqual((await snapshot(page)).reference, reference);
  assert.equal((await snapshot(page)).name, "Renamed edit");

  let releaseResponse;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  let entered;
  const requestStarted = new Promise((resolve) => {
    entered = resolve;
  });
  await context.route("**/api/assistant/turn", async (route) => {
    entered();
    await responseGate;
    await route
      .fulfill({
        json: {
          message: "Late private answer",
          operations: [],
          observations: [],
        },
      })
      .catch(() => {});
  });
  await page.evaluate(async () => {
    const { createAssistantSessionRequest } =
      await import("/src/features/assistant/assistantSessionRequest.ts");
    const workflow = createAssistantSessionRequest({
      pause() {},
      restorePlayback() {},
      releasePlayback() {},
      report(error) {
        throw error;
      },
      nextOperation: () => 1,
    });
    window.pendingTaskLinkCheck = workflow.submit({
      prompt: "Private pending request",
      history: [],
      evidence: [],
    });
  });
  await requestStarted;
  owner = "owner-two";
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  assert.equal((await snapshot(page)).reference, null);
  const privateState = await page.evaluate(async () => ({
    assistant: (
      await import("/src/state/assistant/assistantStore.ts")
    ).useAssistant.getState(),
    items: (
      await import("/src/state/assistant/threadStore.ts")
    ).useAssistantThread.getState().items,
  }));
  assert.equal(privateState.assistant.draft, "");
  assert.deepEqual(privateState.items, []);
  owner = "owner-one";
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  releaseResponse();
  await page.evaluate(() => window.pendingTaskLinkCheck);
  assert.equal(
    await page.evaluate(
      async () =>
        (
          await import("/src/state/assistant/assistantStore.ts")
        ).useAssistant.getState().answer,
    ),
    null,
  );
  assert.deepEqual((await snapshot(page)).reference, reference);
  owner = null;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  assert.equal((await snapshot(page)).reference, null);

  // Exercise the real recovery gate with a temporary IndexedDB-open failure.
  owner = "owner-one";
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let failed = false;
    indexedDB.open = (...args) => {
      if (!failed && args[0] === "restyle-editor-project") {
        failed = true;
        throw new DOMException("Temporary test failure", "UnknownError");
      }
      return open(...args);
    };
  });
  await page.reload();
  await installProbe(page);
  await page.waitForFunction(
    () =>
      window.taskProjectProbe.getProjectStorageStatus().phase ===
      "restore-failed",
  );
  await page.evaluate(async () =>
    (await import("/src/app/projectAutosave.ts")).retryProjectStorage(),
  );
  await ready(page, originalId);
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  assert.deepEqual((await snapshot(page)).reference, reference);
  assert.deepEqual(Buffer.from((await snapshot(page)).media), media);
  assert(
    writes.every((url) => url.endsWith("/api/assistant/turn")),
    "Project/link persistence must not upload media or create a server task",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Task/project link browser check passed: real local save/reload, exact media, rename/Undo, copy, project navigation, account privacy, late response rejection, and failed-restore recovery. Account and assistant HTTP are fixtures; no live task API exists yet.",
  );
  await context.close();
} finally {
  await browser.close();
}
