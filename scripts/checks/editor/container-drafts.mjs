import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
const f = await taskFixture({ services: true });
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
let cookie = f.cookie,
  lost = true,
  page;
const saves = [],
  errors = [];
try {
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const r = await f.request("/api/auth/session", { session: cookie });
    await route.fulfill({ status: r.status, json: r.body });
  });
  await context.route(
    /\/api\/(services(\/.*)?|assistant\/projects)$/,
    async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        body = req.postData() ? req.postDataJSON() : undefined;
      const r = await f.request(url.pathname, {
        method: req.method(),
        body,
        session: cookie,
        headers: { Origin: ORIGIN },
      });
      if (url.pathname.endsWith("/draft") && body) {
        saves.push(body);
        if (lost) {
          lost = false;
          expectStatus(r, 200);
          await route.fulfill({
            status: 503,
            json: { error: "Lost committed save reply" },
          });
          return;
        }
      }
      await route.fulfill({ status: r.status, json: r.body });
    },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let initial = true;
  async function open() {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5319/");
    if (initial) {
      await page
        .getByRole("button", { name: "Blank project", exact: true })
        .click();
      initial = false;
    }
    await page.waitForFunction(
      async () =>
        (await import("/src/app/projectAutosave.ts")).getProjectStorageStatus()
          .phase === "ready",
    );
    await page.evaluate(async () => {
      await (
        await import("/src/state/auth/authGateStore.ts")
      ).refreshAccountSession();
      (await import("/src/state/captureStore.ts")).useCapture
        .getState()
        .patch({ sheet: "more" });
    });
    await page
      .getByRole("button", { name: "Open Containers", exact: true })
      .click();
  }
  await open();
  await page.getByLabel("New Container name").fill("Booking service");
  await page
    .getByRole("button", { name: "Create Container", exact: true })
    .click();
  await page.getByText("Saved draft · revision 0", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  const code = page.getByRole("textbox", {
    name: "Code for src/main.mjs",
    exact: true,
  });
  await code.fill("// unfinished manual draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor();
  await f.restart();
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  assert.equal(await code.inputValue(), "// unfinished manual draft");
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await page.getByText("Saved draft · revision 1", { exact: true }).waitFor();
  assert.deepEqual(saves[1], saves[0]);
  await code.fill("// local work survives reload");
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  assert.equal(await code.inputValue(), "// local work survives reload");
  const list = await f.request("/api/services"),
    id = list.body.services[0].metadata.identity.serviceId;
  const remote = await f.request(`/api/services/${id}/draft`);
  const other = {
    actionId: "concurrent-ai-save",
    expectedRevision: remote.body.revision,
    content: {
      ...remote.body.content,
      files: [{ path: "src/main.mjs", content: "// another author" }],
    },
  };
  expectStatus(
    await f.request(`/api/services/${id}/draft`, { body: other }),
    200,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Save my edits over the reviewed revision",
      exact: true,
    })
    .waitFor();
  assert.equal(await code.inputValue(), "// local work survives reload");
  await page
    .getByRole("button", {
      name: "Save my edits over the reviewed revision",
      exact: true,
    })
    .click();
  await page.getByText("Saved draft · revision 3", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Check draft fields on device", exact: true })
    .click();
  await page
    .getByText("Draft fields checked on this device.", { exact: false })
    .waitFor();
  await code.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-containers-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await code.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-containers-phone.png" });
  cookie = f.otherCookie;
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  assert.equal(await code.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Containers: creation, manual editing, lost committed reply/exact replay, real host restart, local reload, concurrent-author conflict/reapply, device checks and account isolation passed.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: "/tmp/restyle-containers-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await f.close();
}
