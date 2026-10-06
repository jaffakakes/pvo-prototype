import { checkComponentDelivery } from "./component-delivery.mjs";
import { checkComponentTry } from "./component-try.mjs";
import { attachment } from "../../../tests/service-attachments/fixtures.mjs";
import { checkedFixture } from "../../../tests/service-hosting/fixtures.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  taskFixture,
  NOW,
  ORIGIN,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5295/";
const editorUrl = ORIGIN + "/";
const origin = ORIGIN;
const fixture = await taskFixture({
  services: true,
  clock: NOW,
  origin,
  planner: async (request) => {
    const task = await request.json();
    const command = attachment(task.attachmentContext.releaseId);
    command.component.sceneId = task.input.context.currentSceneId;
    command.component.source = {
      structure:
        '<form><heading>Join dinner</heading><field name="guest" kind="name" label="Name"/><submit>Join</submit></form>',
      style: "",
      logic: `on submit { request(${JSON.stringify({
        url: task.attachmentContext.url,
        method: "POST",
        body: JSON.stringify({
          operation: "join",
          input: command.connection.input,
        }),
        onSuccess: { kind: "continue" },
        onError: null,
      })}); }`,
    };
    return Response.json(command);
  },
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const errors = [],
  creations = [];
let page;
async function ready(localId) {
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(editorUrl + (localId ? `?project=${localId}` : ""));
  await page.evaluate(async () => {
    const storage = await import("/src/app/projectAutosave.ts");
    const { useCapture } = await import("/src/state/captureStore.ts");
    window.resultProbe = { storage, useCapture };
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page.waitForFunction(
    (id) =>
      window.resultProbe.storage.getProjectStorageStatus().phase === "ready" &&
      (!id || window.resultProbe.useCapture.getState().localId === id),
    localId,
  );
}
async function finish(task, connected = false) {
  const claimed = await fixture.control({
    action: "step",
    id: task.id,
    command: { kind: "claim", claimId: "result-worker", leaseMs: 60000 },
  });
  expectStatus(claimed, 200);
  let current = claimed.body;
  if (connected) {
    for (const command of [
      { kind: "checkpoint", stepId: "host" },
      { kind: "claim", claimId: "publisher", leaseMs: 60000 },
    ]) {
      const step = await fixture.control({
        action: "step",
        id: task.id,
        command,
      });
      expectStatus(step, 200);
      current = step.body;
    }
    expectStatus(
      await fixture.control({
        action: "publish",
        id: task.id,
        checked: await checkedFixture(),
        guard: {
          expectedRevision: current.revision,
          claim: { id: current.claim.id, generation: current.generation },
        },
      }),
      200,
    );
    expectStatus(
      await fixture.control({
        action: "step",
        id: task.id,
        command: { kind: "checkpoint", stepId: "attach" },
      }),
      200,
    );
    expectStatus(await fixture.control({ action: "sweep" }), 200);
    const completed = await fixture.request(`/api/assistant/tasks/${task.id}`);
    assert.equal(
      completed.body.task.state,
      "ready",
      JSON.stringify(completed.body.task.failure),
    );
    return completed.body.task;
  }
  const result = await fixture.control({
    action: "complete",
    id: task.id,
    guard: {
      expectedRevision: current.revision,
      claim: { id: current.claim.id, generation: current.generation },
    },
    operations: [
      {
        kind: "component.add",
        sceneId: "main",
        componentType: "tooltip",
        at: 0,
        duration: 2,
      },
    ],
  });
  expectStatus(result, 200);
  return result.body;
}
async function snapshot() {
  return page.evaluate(() => {
    const state = window.resultProbe.useCapture.getState();
    return {
      components: state.components.length,
      past: state.past.length,
      ratio: state.ratio,
      applied: state.assistantTaskLinks?.applied?.length ?? 0,
      url: state.clips[0].url,
    };
  });
}
async function ask(text, expectedCount) {
  await page.getByRole("textbox", { name: "Describe a change" }).fill(text);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.waitForFunction(
    (count) =>
      window.resultProbe.useCapture.getState().assistantTaskLinks?.accounts[0]
        ?.taskId &&
      !window.resultProbe.useCapture.getState().assistantTaskLinks?.pending &&
      window.resultProbe.storage.getProjectStorageStatus().storage.dirty ===
        false,
    expectedCount,
  );
  // Observe the server creation and the matching local receipt, not a transient old task card.
  for (let index = 0; creations.length < expectedCount && index < 100; index++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(creations.length, expectedCount);
  const task = creations.at(-1);
  await page.waitForFunction(
    (id) =>
      window.resultProbe.useCapture.getState().assistantTaskLinks?.accounts[0]
        ?.taskId === id &&
      !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
    task.id,
  );
  return task;
}
try {
  // Match the isolated coordinator and host clock for receipt freshness checks.
  await context.addInitScript((now) => {
    Date.now = () => now;
  }, NOW);
  // Serve local source under the same HTTPS origin as the controlled real Worker API.
  // This exercises the production origin contract without weakening auth or request admission.
  await context.route(origin + "/**", async (route) => {
    const target = new URL(route.request().url());
    const response = await route.fetch({
      url: new URL(target.pathname + target.search, sourceUrl).href,
    });
    await route.fulfill({ response });
  });
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const response = await fixture.request("/api/auth/session");
    await route.fulfill({ status: response.status, json: response.body });
  });
  await context.route(
    /\/api\/assistant\/(projects|tasks)(\/.*)?$/,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const body = request.postData() ? request.postDataJSON() : undefined;
      const response = await fixture.request(url.pathname + url.search, {
        body,
        method: request.method(),
        headers: { Origin: origin },
      });
      if (url.pathname === "/api/assistant/tasks" && body)
        creations.push(response.body.task);
      await route.fulfill({ status: response.status, json: response.body });
    },
  );
  await context.route("**/api/assistant/turn", (route) =>
    route.fulfill({
      json: {
        message: "Preparing a saved component",
        operations: [],
        observations: [],
        cloudTask: {
          examples: [
            {
              id: "show",
              input: "Open the component",
              expected: "Show its content",
            },
          ],
        },
      },
    }),
  );
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  await context.route("**/saved-result.mp4", (route) =>
    route.fulfill({ contentType: "video/mp4", body: media }),
  );
  await ready();
  const localId = await page.evaluate(async () => {
    const { mkClip } = await import("/src/store.ts");
    const blob = await (await fetch("/saved-result.mp4")).blob();
    await (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Saved result",
      ratio: "9:16",
      clips: [mkClip(3, URL.createObjectURL(blob), 0)],
    });
    return window.resultProbe.useCapture.getState().localId;
  });
  const original = await snapshot();
  await page.locator("[data-assistant-orb]").click();
  const first = await ask("Build a component for me in the background", 1);
  await page.close();
  const completed = await finish(first, true);
  await fixture.restart();
  await ready(localId);
  assert.notEqual((await snapshot()).url, original.url);
  const stable = await page.evaluate(async () => {
    const { nativeProjectFingerprint } =
      await import("/src/domain/assistant/native/context.ts");
    const { projectSnapshot } = await import("/src/state/project/history.ts");
    await window.resultProbe.storage.saveProjectBeforeUpdate();
    return nativeProjectFingerprint(
      window.resultProbe.storage.persistedProjectSnapshot(
        projectSnapshot(window.resultProbe.useCapture.getState()),
      ),
    );
  });
  assert.equal(stable, first.input.context.fingerprint);
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply result", exact: true }).click();
  await page.getByText("Applied to this draft. You can use Undo.").waitFor();
  await page.waitForFunction(
    () => !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
  );
  assert.deepEqual(
    { ...(await snapshot()), url: null },
    { components: 1, past: 1, ratio: "9:16", applied: 1, url: null },
  );
  const connection = await page.evaluate(() => {
    const state = window.resultProbe.useCapture.getState();
    return {
      connection: state.components[0].serviceConnection,
      hosts: state.allowedDomains,
      action: state.components[0].code.pvoCompiled.rules[0].action,
    };
  });
  assert.equal(connection.connection.receipt.identity.taskId, first.id);
  assert.equal(connection.connection.origin, origin);
  assert.deepEqual(connection.hosts, [new URL(origin).host]);
  assert.equal(connection.action.kind, "request");
  await page.screenshot({ path: "/tmp/restyle-saved-result-applied.png" });
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().undo();
    await window.resultProbe.storage.saveProjectBeforeUpdate();
  });
  await page.close();
  await ready(localId);
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page.getByText("Applied to this draft. You can use Undo.").waitFor();
  await page.evaluate(async (task) => {
    await (
      await import("/src/features/assistant/saved-tasks/applicationCommands.ts")
    ).applySavedTaskResult(
      {
        ownerId: task.ownerId,
        projectId: task.input.projectId,
        taskId: task.id,
      },
      new AbortController().signal,
    );
  }, completed);
  assert.equal(
    (await snapshot()).components,
    0,
    "Reload and duplicate completion must preserve Undo",
  );
  await page.evaluate(() => window.resultProbe.useCapture.getState().redo());
  assert.equal((await snapshot()).components, 1);
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.resultProbe.useCapture.getState().components[0]
          .serviceConnection,
    ),
    connection.connection,
  );
  await checkComponentTry({
    context,
    fixture,
    origin,
    getPage: () => page,
    reopen: async () => {
      await page.close();
      await fixture.restart();
      await ready(localId);
    },
  });
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await checkComponentDelivery({ context, fixture, origin, page });
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  const second = await ask("Build another saved component", 2);
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().edit({ ratio: "1:1" });
    await window.resultProbe.storage.saveProjectBeforeUpdate();
  });
  await page.close();
  await finish(second);
  await ready(localId);
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply result", exact: true }).click();
  await page
    .getByText(/Your draft changed while this task was working/)
    .waitFor();
  const after = await snapshot();
  assert.equal(after.ratio, "1:1");
  assert.equal(after.components, 1);
  assert.equal(after.applied, 1);
  assert.equal(
    (await fixture.request(`/api/assistant/tasks/${second.id}`)).body.task
      .state,
    "ready",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Apply result", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Apply result", exact: true }).click();
  await page
    .getByText(/Your draft changed while this task was working/)
    .waitFor();
  await page.screenshot({
    path: "/tmp/restyle-saved-result-changed-phone.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Saved connected result: actual compiler/host receipt, closed-page completion, runtime restart, stable media identity, atomic component/connection/host apply, duplicate/reload/Undo/Redo and changed-draft protection passed.",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  console.error("Page errors", errors);
  await page.screenshot({ path: "/tmp/restyle-saved-result-failure.png" });
  throw error;
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
