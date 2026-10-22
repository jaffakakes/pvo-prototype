import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "../editor/assistant-fixture.mjs";

/** Real editor creation/application. Only foreground handoff and local account identity are controlled. */
export async function createDurableBrowser(fixture, request, directory) {
  const sourceUrl = process.env.EDITOR_URL ?? "http://127.0.0.1:5295/";
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  let page, task, localId;
  async function open() {
    page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ORIGIN + (localId ? `/?project=${localId}` : "/"));
    await page.evaluate(async () => {
      window.resultProbe = {
        storage: await import("/src/app/projectAutosave.ts"),
        useCapture: (await import("/src/state/captureStore.ts")).useCapture,
      };
      await (
        await import("/src/state/auth/authGateStore.ts")
      ).refreshAccountSession();
    });
    await page.waitForFunction(
      (id) =>
        window.resultProbe.storage.getProjectStorageStatus().phase ===
          "ready" &&
        (!id || window.resultProbe.useCapture.getState().localId === id),
      localId,
    );
  }
  try {
    await context.route(ORIGIN + "/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: new URL(url.pathname + url.search, sourceUrl).href,
      });
      await route.fulfill({ response });
    });
    await context.route(ORIGIN + "/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await fixture.request(url.pathname + url.search, {
        method: request.method(),
        headers: { Origin: ORIGIN },
        ...(request.postData() ? { body: request.postDataJSON() } : {}),
      });
      if (
        url.pathname === "/api/assistant/tasks" &&
        request.method() === "POST"
      )
        task = response.body.task;
      await route.fulfill({ status: response.status, json: response.body });
    });
    await installAssistantAvailabilityFixture(context);
    await context.route("**/api/publishing", (route) =>
      route.fulfill({
        json: { available: false, hasSession: false, maxBytes: 0 },
      }),
    );
    await context.route("**/api/renders", (route) =>
      route.fulfill({
        json: {
          available: false,
          maxSourceBytes: 0,
          maxSources: 0,
          formats: [],
          qualities: [],
        },
      }),
    );
    await context.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          message: "Preparing the saved component.",
          operations: [],
          observations: [],
          cloudTask: {
            examples: [
              {
                id: "goal",
                input: "Use the component",
                expected: "Complete the requested interaction",
              },
            ],
          },
        },
      }),
    );
    const media = await readFile(
      new URL("../../../share/assets/preview.mp4", import.meta.url),
    );
    await context.route("**/reliability-source.mp4", (route) =>
      route.fulfill({ contentType: "video/mp4", body: media }),
    );
    await open();
    localId = await page.evaluate(async () => {
      const { mkClip } = await import("/src/store.ts");
      const media = await (await fetch("/reliability-source.mp4")).blob();
      await (
        await import("/src/features/create-project/projectCommands.ts")
      ).createProject({
        name: "AI reliability journey",
        ratio: "9:16",
        clips: [mkClip(3, URL.createObjectURL(media), 0)],
      });
      return window.resultProbe.useCapture.getState().localId;
    });
    await page.locator("[data-assistant-orb]").click();
    await page
      .getByRole("textbox", { name: "Describe a change" })
      .fill(request);
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        window.resultProbe.useCapture.getState().assistantTaskLinks?.accounts[0]
          ?.taskId &&
        !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
    );
    assert.ok(task, "The real editor must create the saved task.");
    await page.close();
    return {
      browser,
      context,
      task,
      origin: ORIGIN,
      errors,
      get page() {
        return page;
      },
      async apply() {
        await open();
        await page
          .getByRole("button", { name: "Open saved task", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Apply result", exact: true })
          .click();
        await page
          .getByText("Applied to this draft. You can use Undo.")
          .waitFor();
        await page.waitForFunction(
          () =>
            !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
        );
        const value = await page.evaluate(() => {
          const state = window.resultProbe.useCapture.getState();
          return { components: state.components, past: state.past.length };
        });
        assert.equal(
          value.past,
          1,
          "The entire generated result must apply atomically.",
        );
        assert.equal(
          value.components.length,
          2,
          "The requested journey needs its connected control and visible result Note.",
        );
        await page.screenshot({ path: directory + "/applied.png" });
        return value;
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
