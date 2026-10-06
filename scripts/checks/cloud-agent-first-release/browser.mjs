import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { installAssistantAvailabilityFixture } from "../editor/assistant-fixture.mjs";
import { scenarios } from "./scenarios.js";

/** Real editor and saved-result application; only account identity and foreground handoff are fixtures. */
export async function openCreatorJourney({
  origin,
  sourceUrl,
  proofId,
  call,
  record,
}) {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const sessions = new Map();
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  async function api(subject, path, method = "GET", body) {
    const response = await call(`/${subject}/api`, "POST", {
      path,
      method,
      ...(body === undefined ? {} : { body }),
    });
    assert.equal(response.status, 200, "Diagnostic API bridge unavailable");
    return response.data;
  }
  async function ready(session) {
    const page = await session.context.newPage();
    session.page = page;
    page.setDefaultTimeout(25000);
    page.on("pageerror", (error) => session.errors.push(error.message));
    await page.goto(
      origin + (session.localId ? `/?project=${session.localId}` : "/"),
    );
    await page.evaluate(async () => {
      const storage = await import("/src/app/projectAutosave.ts");
      const { useCapture } = await import("/src/state/captureStore.ts");
      window.resultProbe = { storage, useCapture };
      await (
        await import("/src/state/auth/authGateStore.ts")
      ).refreshAccountSession();
    });
    try {
      await page.waitForFunction(
        (id) =>
          window.resultProbe.storage.getProjectStorageStatus().phase ===
            "ready" &&
          (!id || window.resultProbe.useCapture.getState().localId === id),
        session.localId,
      );
    } catch (error) {
      await record("creator_storage_not_ready", {
        subject: session.subject,
        errors: session.errors,
        storage: await page.evaluate(() =>
          window.resultProbe.storage.getProjectStorageStatus(),
        ),
      });
      throw error;
    }
    return page;
  }
  async function start(subject) {
    const scenario = scenarios[subject];
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const session = {
      subject,
      context,
      localId: null,
      page: null,
      errors: [],
      task: null,
    };
    sessions.set(subject, session);
    await context.route(origin + "/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: new URL(url.pathname + url.search, sourceUrl).href,
      });
      await route.fulfill({ response });
    });
    await installAssistantAvailabilityFixture(context);
    await context.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          available: true,
          clerkAvailable: false,
          clerkPublishableKey: null,
          canLinkEmail: false,
          emailLinked: false,
          user: {
            id: `proof-${proofId}-${subject}`,
            name: `Acceptance ${subject}`,
          },
        },
      }),
    );
    await context.route("**/api/publishing", (route) =>
      route.fulfill({
        json: { available: false, hasSession: true, maxBytes: 0 },
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
    await context.route(
      /\/api\/(assistant\/(projects|tasks)|services)(\/.*|\?.*)?$/,
      async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.pathname.endsWith("/actions")) return route.continue();
        const reply = await api(
          subject,
          url.pathname + url.search,
          request.method(),
          request.postData() ? request.postDataJSON() : undefined,
        );
        if (
          url.pathname === "/api/assistant/tasks" &&
          request.method() === "POST"
        ) {
          assert.equal(request.postDataJSON().request, scenario.request);
          session.task = reply.body.task;
        }
        try {
          await route.fulfill({ status: reply.status, json: reply.body });
        } catch {
          /* Closing the creator deliberately loses in-flight reads. */
        }
      },
    );
    await context.route("**/api/assistant/turn", (route) => {
      assert.equal(route.request().postDataJSON().prompt, scenario.request);
      return route.fulfill({
        json: {
          message: "Starting saved construction",
          operations: [],
          observations: [],
          cloudTask: { examples: scenario.examples },
        },
      });
    });
    await context.route("**/acceptance.mp4", (route) =>
      route.fulfill({ contentType: "video/mp4", body: media }),
    );
    const page = await ready(session);
    session.localId = await page.evaluate(async (subject) => {
      const { mkClip } = await import("/src/store.ts");
      const blob = await (await fetch("/acceptance.mp4")).blob();
      await (
        await import("/src/features/create-project/projectCommands.ts")
      ).createProject({
        name: `Acceptance ${subject}`,
        ratio: "9:16",
        clips: [mkClip(3, URL.createObjectURL(blob), 0)],
      });
      return window.resultProbe.useCapture.getState().localId;
    }, subject);
    await page.locator("[data-assistant-orb]").click();
    await page
      .getByRole("textbox", { name: "Describe a change" })
      .fill(scenario.request);
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        window.resultProbe.useCapture.getState().assistantTaskLinks?.accounts[0]
          ?.taskId &&
        !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
    );
    assert.ok(session.task?.id, "The browser must create a real saved task");
    await page.close();
    await record("creator_closed_during_authoring", {
      subject,
      taskId: session.task.id,
      localId: session.localId,
    });
    return { status: 200, data: { task: session.task } };
  }
  async function apply(subject, snapshot) {
    const session = sessions.get(subject);
    const page = await ready(session);
    await page
      .getByRole("button", { name: "Open saved task", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Apply result", exact: true })
      .click();
    await page.getByText("Applied to this draft. You can use Undo.").waitFor();
    await page.waitForFunction(
      () => !window.resultProbe.storage.getProjectStorageStatus().storage.dirty,
    );
    const applied = await page.evaluate(() => {
      const state = window.resultProbe.useCapture.getState();
      return {
        count: state.components.length,
        service: state.components[0]?.serviceConnection,
        code: state.components[0]?.code,
      };
    });
    assert.equal(applied.count, 1);
    assert.equal(applied.service.receipt.identity.taskId, snapshot.task.id);
    assert.deepEqual(session.errors, []);
    await record("saved_component_applied_after_reopen", { subject, applied });
    return session;
  }
  return {
    browser,
    origin,
    api,
    start,
    apply,
    reopen: ready,
    sessions,
    close: () => browser.close(),
  };
}
