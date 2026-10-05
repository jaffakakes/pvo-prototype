import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  ORIGIN,
  path,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5294/";
const fixture = await taskFixture({
  planner: async (request) => {
    const task = await request.json();
    return Response.json(
      task.questions.some((item) => item.answer)
        ? { kind: "checkpoint", stepId: "build" }
        : {
            kind: "ask",
            question: {
              id: "day",
              revision: 0,
              prompt: "Which day should friends meet?",
              choices: ["Friday", "Saturday"],
              answer: null,
            },
          },
    );
  },
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
let releaseLost;
let enteredCreate;
const lost = new Promise((resolve) => {
  releaseLost = resolve;
});
const created = new Promise((resolve) => {
  enteredCreate = resolve;
});
let holdFirst = true;
let cookie = fixture.cookie;
let createdTask;
const creations = [],
  actions = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});

async function ready(page, localId) {
  await page.evaluate(async () => {
    const storage = await import("/src/app/projectAutosave.ts");
    const { useCapture } = await import("/src/state/captureStore.ts");
    window.savedTaskProbe = { storage, useCapture };
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page.waitForFunction((id) => {
    const { storage, useCapture } = window.savedTaskProbe;
    return (
      storage.getProjectStorageStatus().phase === "ready" &&
      (!id || useCapture.getState().localId === id)
    );
  }, localId);
}

try {
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const response = await fixture.request("/api/auth/session", {
      session: cookie,
    });
    await route.fulfill({ status: response.status, json: response.body });
  });
  await context.route(
    /\/api\/assistant\/(projects|tasks)(\/.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postData() ? request.postDataJSON() : undefined;
      const response = await fixture.request(url.pathname + url.search, {
        method: request.method(),
        body,
        session: cookie,
        headers: { Origin: ORIGIN },
      });
      if (url.pathname === "/api/assistant/tasks" && body) {
        creations.push(body);
        createdTask = response.body.task;
        if (holdFirst) {
          holdFirst = false;
          enteredCreate();
          await lost;
        }
      } else if (body) actions.push(url.pathname);
      try {
        await route.fulfill({ status: response.status, json: response.body });
      } catch {
        /* A closed page deliberately loses the response. */
      }
    },
  );
  await context.route("**/api/assistant/turn", (route) =>
    route.fulfill({
      json: {
        message: "Starting saved planning",
        operations: [],
        observations: [],
        cloudTask: {
          examples: [
            {
              id: "accept",
              input: "A friend accepts the invitation",
              expected: "Their acceptance is saved",
            },
          ],
        },
      },
    }),
  );
  let page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(editorUrl);
  await ready(page);
  const localId = await page.evaluate(async () => {
    await (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({ name: "Saved cloud planning", ratio: "9:16", clips: [] });
    return window.savedTaskProbe.useCapture.getState().localId;
  });
  await page.locator("[data-assistant-orb]").click();
  await page
    .getByRole("textbox", { name: "Describe a change" })
    .fill("Make an invitation that saves my friends' acceptances");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await created;
  assert.ok(createdTask);
  assert.equal(
    await page.evaluate(
      () => window.savedTaskProbe.useCapture.getState().past.length,
    ),
    0,
    "Handoff never writes native Undo history",
  );
  const pending = await page.evaluate(async (id) => {
    const { openProjectDatabase, readProjectCheckpoint } =
      await import("/src/infrastructure/projectPersistence/indexedDb.ts");
    const db = await openProjectDatabase();
    try {
      return (await readProjectCheckpoint(db, id)).assistantTaskLinks.pending[0]
        .input;
    } finally {
      db.close();
    }
  }, localId);
  assert.deepEqual(pending, creations[0]);
  const savedUrl = page.url();
  await page.close();
  releaseLost();
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(savedUrl);
  await ready(page, localId);
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Which day should friends meet?" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-assistant-thread][data-variant="phone"]').waitFor();
  await page
    .getByRole("textbox", { name: "Which day should friends meet?" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-saved-task-question-phone.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('[data-assistant-thread][data-variant="desktop"]')
    .waitFor();
  assert.equal(creations.length, 2);
  assert.deepEqual(
    creations[0],
    creations[1],
    "Reload replays exact original creation identity and content",
  );
  assert.equal(
    (
      await fixture.request(
        `/api/assistant/tasks?project=${createdTask.input.projectId}`,
      )
    ).body.tasks.length,
    1,
  );
  await page.getByRole("button", { name: "Friday", exact: true }).click();
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await page
    .getByText(
      "Planning is saved. Building hosted services is not available yet.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await fixture.request(path(createdTask))).body.task.questions[0].answer
      .value,
    "Friday",
  );
  await page.getByRole("button", { name: "Stop task", exact: true }).click();
  await page
    .locator("[data-saved-task]")
    .getByText("Stopped", { exact: true })
    .waitFor();
  assert.equal(
    actions.filter((action) => action.endsWith("/answers")).length,
    1,
  );
  assert.equal(actions.filter((action) => action.endsWith("/stop")).length, 1);

  await page.reload();
  await ready(page, localId);
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page
    .locator("[data-saved-task]")
    .getByText("Stopped", { exact: true })
    .waitFor();
  await page.screenshot({ path: "/tmp/restyle-saved-task-desktop.png" });
  cookie = null;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page
    .locator("[data-saved-task]")
    .getByRole("button", { name: "Sign in", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("Make an invitation that saves my friends' acceptances", {
        exact: true,
      })
      .count(),
    0,
  );
  cookie = fixture.otherCookie;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  assert.equal(await page.locator("[data-saved-task]").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Open saved task", exact: true })
      .count(),
    0,
  );
  cookie = fixture.cookie;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page
    .locator("[data-saved-task]")
    .getByText("Stopped", { exact: true })
    .waitFor();
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 693 },
  ]) {
    await page.setViewportSize(size);
    await page.locator("[data-saved-task]").waitFor();
    await page
      .locator('[data-assistant-thread][data-variant="phone"]')
      .waitFor();
    await page.waitForFunction(() => {
      const rect = document
        .querySelector("[data-saved-task]")
        ?.getBoundingClientRect();
      return rect && rect.left >= 0 && rect.right <= innerWidth + 1;
    });
    const geometry = await page.evaluate(() => {
      const panel = document
        .querySelector("[data-saved-task]")
        .getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        left: panel.left,
        right: panel.right,
      };
    });
    assert.ok(geometry.scrollWidth <= geometry.width + 1);
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1);
    await page.screenshot({
      path: `/tmp/restyle-saved-task-${size.width}.png`,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Saved-task editor: real IndexedDB + real workerd/D1/SQLite; lost response/page closure/replay, question, answer, Stop, reload, account isolation, desktop and phone passed. Model output and HTTP bridge are fixtures.",
  );
} catch (error) {
  const page = context.pages()[0];
  if (page) {
    console.error(
      "Browser failure state",
      await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(-5000),
        storage: window.savedTaskProbe?.storage.getProjectStorageStatus(),
        localId: window.savedTaskProbe?.useCapture.getState().localId,
      })),
    );
    await page.screenshot({ path: "/tmp/restyle-saved-task-failure.png" });
  }
  console.error("Page errors", errors);
  throw error;
} finally {
  releaseLost();
  await context.close();
  await browser.close();
  await fixture.close();
}
