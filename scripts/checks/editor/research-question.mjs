import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  ORIGIN,
  path,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { deferred } from "../../../tests/assistant-task-server/provider.helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const release = deferred();
let createdTask,
  reads = 0,
  resumed;
const fixture = await taskFixture({
  workspaces: true,
  productionLeases: true,
  researchFetch: async (request) => {
    if (new URL(request.url).hostname === "dns.google")
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "8.8.8.8" }],
      });
    reads++;
    await release.promise;
    return new Response("Availability documentation requires calendar.read.", {
      headers: { "content-type": "text/plain" },
    });
  },
  planner: async (request) => {
    const task = await request.json();
    if (task.stepId === "plan")
      return Response.json({ kind: "checkpoint", stepId: "build" });
    if (!task.questions.length)
      return Response.json({
        kind: "ask_research",
        prompt: "Which calendar should supply your available times?",
        choices: ["Work calendar", "Personal calendar"],
        calls: [
          {
            kind: "web_read",
            url: "https://calendar.example.com/docs/availability",
          },
          { kind: "connections_read", after: null },
        ],
      });
    resumed = task;
    return Response.json({
      kind: "ask",
      prompt: "That account is not connected yet. Prepare a manual request?",
      choices: ["Prepare a request", "Wait for setup"],
    });
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
const errors = [];
try {
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
      const response = await fixture.request(url.pathname + url.search, {
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : undefined,
        headers: { Origin: ORIGIN },
      });
      if (
        url.pathname === "/api/assistant/tasks" &&
        request.method() === "POST"
      )
        createdTask = response.body.task;
      await route.fulfill({ status: response.status, json: response.body });
    },
  );
  await context.route("**/api/assistant/turn", (route) =>
    route.fulfill({
      json: {
        message: "Starting saved research",
        operations: [],
        observations: [],
        cloudTask: {
          examples: [
            {
              id: "privacy",
              input: "Calendar includes a private event",
              expected: "Viewers see busy time without event details",
            },
          ],
        },
      },
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5320/");
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
    window.researchProbe = {
      storage: await import("/src/app/projectAutosave.ts"),
      capture: (await import("/src/state/captureStore.ts")).useCapture,
    };
  });
  await page.waitForFunction(
    () =>
      window.researchProbe.storage.getProjectStorageStatus().phase === "ready",
  );
  await page.evaluate(async () =>
    (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Research while answering",
      ratio: "9:16",
      clips: [],
    }),
  );
  await page.locator("[data-assistant-orb]").click();
  await page
    .getByRole("textbox", { name: "Describe a change" })
    .fill("Show my available calendar times");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const prompt = "Which calendar should supply your available times?";
  await page.getByRole("textbox", { name: prompt, exact: true }).waitFor();
  const panel = page.locator("[data-saved-task]");
  await panel
    .getByText(
      "You can answer now while independent research finishes. Other work waits for your answer.",
      { exact: true },
    )
    .waitFor();
  const running = (await fixture.request(path(createdTask))).body.task;
  assert.equal(running.state, "running");
  await page
    .getByRole("textbox", { name: prompt, exact: true })
    .fill("Work calendar");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await panel.getByText("Saved answers", { exact: true }).waitFor();
  release.resolve();
  await page
    .getByRole("textbox", {
      name: "That account is not connected yet. Prepare a manual request?",
      exact: true,
    })
    .waitFor();
  assert.equal(resumed.questions[0].answer.value, "Work calendar");
  assert.equal(reads, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-assistant-thread][data-variant="phone"]').waitFor();
  await panel.getByText("Saved answers", { exact: true }).click();
  await panel.getByText("Work calendar", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/restyle-research-question-phone.png" });
  await page.reload();
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "That account is not connected yet. Prepare a manual request?",
      exact: true,
    })
    .waitFor();
  const latest = (await fixture.request(path(createdTask))).body.task;
  assert.equal(latest.questions[0].answer.value, "Work calendar");
  assert.equal(reads, 1);
  expectStatus(
    await fixture.request(`${path(latest)}/stop`, {
      body: { expectedRevision: latest.revision },
    }),
    200,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Real editor/phone/reload + local Worker/SQLite: question shown during independent research, early answer retained, batch completes once, new focused question, saved answer after reload. Model and public provider are fixtures; no live account effects.",
  );
} catch (error) {
  const page = context.pages()[0];
  if (page) {
    console.error(
      await page.evaluate(() => document.body.innerText.slice(-5000)),
    );
    await page.screenshot({
      path: "/tmp/restyle-research-question-failure.png",
    });
  }
  console.error(
    "Task",
    createdTask ? (await fixture.request(path(createdTask))).body : null,
    "Page errors",
    errors,
  );
  throw error;
} finally {
  release.resolve();
  await context.close();
  await browser.close();
  await fixture.close();
}
