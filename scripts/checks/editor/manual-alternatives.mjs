import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  manualFixture,
  untilQuestion,
  finishManualPreparation,
} from "../../../tests/assistant-task-server/manual-alternatives.fixture.mjs";
import {
  ORIGIN,
  NOW,
  path,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const proofTime = Date.now();
const fixture = await manualFixture({ clock: proofTime });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: "reduce",
});
let task,
  cookie = fixture.cookie,
  loseResolution = true;
const errors = [];
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
try {
  await context.route(ORIGIN + "/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: new URL(
          url.pathname + url.search,
          process.env.EDITOR_URL || "http://127.0.0.1:5324/",
        ).href,
      }),
    });
  });
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
    /\/api\/(assistant\/(projects|tasks)|services)(\/.*)?$/,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await fixture.request(url.pathname + url.search, {
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : undefined,
        session: cookie,
        headers: { Origin: ORIGIN },
      });
      if (
        url.pathname === "/api/assistant/tasks" &&
        request.method() === "POST" &&
        response.status === 201
      ) {
        task = await untilQuestion(fixture, response.body.task);
        response.body.task = task;
      }
      if (
        url.pathname.endsWith("/answers") &&
        response.status === 200 &&
        response.body.task.manualPlans.length
      ) {
        task = await finishManualPreparation(fixture, response.body.task);
        response.body.task = task;
      }
      if (
        url.pathname.endsWith("/manual") &&
        response.status === 200 &&
        loseResolution
      ) {
        loseResolution = false;
        await route.abort("connectionfailed");
        return;
      }
      await route.fulfill({ status: response.status, json: response.body });
    },
  );
  await context.route("**/api/assistant/turn", (route) =>
    route.fulfill({
      json: {
        message: "Starting saved work",
        operations: [],
        observations: [],
        cloudTask: {
          examples: [
            {
              id: "pending",
              input: "A preference is saved",
              expected: "The external booking still needs a person",
            },
          ],
        },
      },
    }),
  );
  await page.goto(ORIGIN);
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
    window.manualProbe = {
      storage: await import("/src/app/projectAutosave.ts"),
      capture: (await import("/src/state/captureStore.ts")).useCapture,
    };
  });
  await page.waitForFunction(
    () =>
      window.manualProbe.storage.getProjectStorageStatus().phase === "ready",
  );
  await page.evaluate(async () =>
    (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Manual alternative acceptance",
      ratio: "9:16",
      clips: [],
    }),
  );
  await page.locator("[data-assistant-orb]").click();
  await page
    .getByRole("textbox", { name: "Describe a change" })
    .fill("Reserve a table");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const panel = page.locator("[data-saved-task]");
  await panel.getByRole("heading", { name: "What will change" }).waitFor();
  await panel
    .getByRole("button", { name: "Keep my original request", exact: true })
    .click();
  assert.deepEqual(
    (await fixture.request(path(task))).body.task.manualPlans,
    [],
  );
  await panel
    .getByRole("heading", { name: "What will change" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2d-choice-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(
      '[data-assistant-thread][data-variant="phone"] [data-saved-task][aria-busy="false"]',
    )
    .waitFor();
  await page.locator('[data-assistant-thread][data-variant="phone"]').waitFor();
  await panel
    .getByRole("heading", { name: "What will change" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2d-choice-phone.png" });
  assert.ok(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  );
  await panel
    .getByRole("button", { name: "Use this alternative", exact: true })
    .click();
  await panel.getByRole("button", { name: "Save answer", exact: true }).click();
  await panel.getByText("Ready · follow-up pending", { exact: true }).waitFor();
  await panel
    .getByRole("button", { name: "Apply result", exact: true })
    .click();
  await panel
    .getByText("Applied to this draft. You can use Undo.", { exact: true })
    .waitFor();
  const component = await page.evaluate(
    () => window.manualProbe.capture.getState().components[0],
  );
  assert.equal(component.type, "form");
  assert.ok(JSON.stringify(component).includes("Identify whose preference"));
  assert.ok(JSON.stringify(component).includes("still needs to be booked"));
  // Actual compiled iframe and offline Try request; successful preparation cannot resolve a human step.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(async () => {
    window.manualProbe.capture.getState().patch({ t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    window.manualProbe.capture.getState().patch({ playing: false });
    window.manualProbe.feedback = (
      await import("/src/features/preview/tryFeedbackStore.ts")
    ).useTryFeedback;
  });
  const frame = page
    .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
    .first()
    .contentFrame();
  await frame.getByRole("textbox").fill("Sam");
  const tryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/try") && response.request().method() === "POST",
  );
  await frame
    .getByRole("button", { name: "Save preference", exact: true })
    .click();
  const response = await tryResponse;
  assert.equal(response.status(), 200);
  assert.ok(
    JSON.stringify(await response.json()).includes("saved_for_manual_followup"),
  );
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );
  assert.equal(
    (await fixture.request(path(task))).body.task.manualPlans[0].steps[0]
      .resolution,
    null,
  );
  await fixture.restart();
  await fixture.control({ action: "time", now: proofTime });
  await page.reload();
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await panel.getByText("Ready · follow-up pending", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(
      '[data-assistant-thread][data-variant="phone"] [data-saved-task][aria-busy="false"]',
    )
    .waitFor();
  await panel
    .getByRole("textbox", { name: "What happened?", exact: true })
    .fill("I called the venue and received confirmation.");
  await panel
    .getByRole("button", { name: "Mark completed", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2d-followup-phone.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .locator('[data-assistant-thread][data-variant="desktop"]')
    .waitFor();
  await panel
    .getByRole("textbox", { name: "What happened?", exact: true })
    .fill("I called the venue and received confirmation.");
  await panel
    .getByRole("textbox", { name: "What happened?", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2d-followup-desktop.png" });
  await panel
    .getByRole("button", { name: "Mark completed", exact: true })
    .click();
  await panel.getByRole("alert").waitFor();
  await panel
    .getByRole("button", { name: "Mark completed", exact: true })
    .click();
  await panel.getByText("Marked completed", { exact: true }).waitFor();
  const completed = (await fixture.request(path(task))).body.task;
  assert.equal(
    completed.manualPlans[0].steps[0].resolution.note,
    "I called the venue and received confirmation.",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Open saved task", exact: true })
    .click();
  await panel.getByText("Marked completed", { exact: true }).waitFor();
  cookie = fixture.otherCookie;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes(
        "I called the venue and received confirmation.",
      ),
  );
  expectStatus(await fixture.request(path(task), { session: cookie }), 404);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual editor desktop/phone choice, saved consent, automatic checked preparation, normal component apply, compiled fields/purpose/notice, Try without false human completion, Worker/browser restart, lost resolution reply recovery, owner switch. Model/source and Node compute are controlled local fixtures; no paid infrastructure or real external booking.",
  );
} catch (error) {
  console.error(
    await page.evaluate(() => document.body.innerText.slice(-5000)),
  );
  await page.screenshot({ path: "/tmp/restyle-2d-browser-failure.png" });
  throw error;
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
