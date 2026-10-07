import { dinnerSource } from "../../../tests/service-validation/fixtures.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  taskFixture,
  hosted,
  publicCall,
  call,
  action,
  expectStatus,
  version,
  status,
} from "../../../tests/service-actions/helpers.mjs";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
const fixture = await taskFixture({ services: true });
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
let cookie = fixture.cookie,
  lost = true,
  lostReset = true;
const commands = [],
  errors = [];
let page;
try {
  const service = await hosted(fixture);
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route("**/api/auth/session", async (route) => {
    const r = await fixture.request("/api/auth/session", { session: cookie });
    await route.fulfill({ status: r.status, json: r.body });
  });
  await context.route(/\/api\/services(\/.*)?$/, async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      body = req.postData() ? req.postDataJSON() : undefined;
    let reply;
    try {
      reply = await fixture.request(url.pathname, {
        method: req.method(),
        body,
        session: cookie,
        headers: { Origin: ORIGIN },
      });
    } catch {
      await route.fulfill({
        status: 503,
        json: { error: "Fixture restarting" },
      });
      return;
    }
    if (body) commands.push(body);
    if (body?.kind === "activate" && lost) {
      lost = false;
      expectStatus(reply, 200);
      await route.fulfill({ status: 503, json: { error: "Lost response" } });
      return;
    }
    if (body?.kind === "reset_test" && lostReset) {
      lostReset = false;
      expectStatus(reply, 200);
      await route.fulfill({ status: 503, json: { error: "Lost reset reply" } });
      return;
    }
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let initial = true;
  async function open() {
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5299/");
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
  await page
    .getByRole("button", { name: "Publish checked version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor();
  await open();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause Container", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(
    commands[1],
    commands[0],
    "A reload retries the exact saved activation",
  );
  assert.equal(
    (await publicCall(fixture, service, action("live", "Viewer"))).body.result,
    "accepted",
  );
  expectStatus(
    await call(fixture, service, action("test-guest", "Test guest")),
    200,
  );
  await page
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  const liveArea = page.getByRole("region", {
    name: "Live records",
    exact: true,
  });
  const testArea = page.getByRole("region", {
    name: "Test records 1",
    exact: true,
  });
  await liveArea.getByText("View records", { exact: true }).click();
  await testArea.getByText("View records", { exact: true }).click();
  assert(
    (
      await liveArea.locator("details").first().locator("pre").textContent()
    ).includes("Viewer"),
  );
  assert(
    (
      await testArea.locator("details").first().locator("pre").textContent()
    ).includes("Test guest"),
  );
  await testArea
    .getByRole("button", { name: "Reset test records", exact: true })
    .click();
  await testArea
    .getByRole("button", { name: "Keep test records", exact: true })
    .click();
  assert(
    (
      await testArea.locator("details").first().locator("pre").textContent()
    ).includes("Test guest"),
  );
  await testArea
    .getByRole("button", { name: "Reset test records", exact: true })
    .click();
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/reset_test") && response.status() === 503,
  );
  await testArea
    .getByRole("button", { name: "Confirm test reset", exact: true })
    .click();
  await resetResponse;
  await fixture.restart();
  await open();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .waitFor({ state: "hidden" });
  const resets = commands.filter((command) => command.kind === "reset_test");
  assert.deepEqual(resets[1], resets[0]);
  await page
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  await testArea.getByText("View records", { exact: true }).click();
  assert(
    !(
      await testArea.locator("details").first().locator("pre").textContent()
    ).includes("Test guest"),
  );
  await liveArea.getByText("View records", { exact: true }).click();
  assert(
    (
      await liveArea.locator("details").first().locator("pre").textContent()
    ).includes("Viewer"),
  );
  await testArea
    .getByText("Recent results and failures", { exact: true })
    .click();
  await testArea.getByText('"accepted"', { exact: true }).waitFor();
  assert.equal(
    (await call(fixture, service, action("test-guest", "Test guest"))).body
      .result,
    "accepted",
  );
  await liveArea.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-records-desktop.png" });
  await page
    .getByRole("button", { name: "Close records and usage", exact: true })
    .click();
  const candidate = await version(fixture, service, {
    source: dinnerSource + "\n// A new checked version.",
  });
  await page
    .getByRole("button", { name: "Refresh Containers", exact: true })
    .click();
  await page.getByText("Container details", { exact: true }).click();
  await page
    .getByRole("button", { name: "Use version 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use version 1", exact: true })
    .waitFor();
  assert.equal(
    (await status(fixture, service)).body.summary.service.liveReleaseId,
    candidate.identity.resourceId,
  );
  await page
    .getByRole("button", { name: "Use version 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use version 2", exact: true })
    .waitFor();
  assert.equal(
    (await publicCall(fixture, service, action("after-rollback", "Viewer")))
      .body.result,
    "already_joined",
  );
  await page
    .getByRole("button", { name: "Pause Container", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep Container running", exact: true })
    .click();
  assert.equal(
    (await status(fixture, service)).body.summary.service.state,
    "active",
  );
  await page
    .getByRole("button", { name: "Pause Container", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm pause", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume Container", exact: true })
    .waitFor();
  expectStatus(await publicCall(fixture, service, action("paused")), 404);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume Container", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-services-phone.png" });
  await page
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  await liveArea.getByText("View records", { exact: true }).click();
  await liveArea.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-records-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  cookie = fixture.otherCookie;
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Resume Container", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Live records", exact: true })
      .count(),
    0,
  );
  cookie = fixture.cookie;
  await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
  });
  await page
    .getByRole("button", { name: "Resume Container", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause Container", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Delete Container", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep Container", exact: true })
    .click();
  assert.equal(
    (await publicCall(fixture, service, action("existing", "Viewer"))).body
      .result,
    "already_joined",
  );
  await page
    .getByRole("button", { name: "Delete Container", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete Container permanently", exact: true })
    .click();
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  expectStatus(await publicCall(fixture, service, action("deleted")), 404);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh Containers", exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  await page.screenshot({ path: "/tmp/restyle-services-desktop.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Service manager passed: real HTTP/workerd/SQLite lifecycle, lost activation response and reload, exact retry, checked version selection/rollback without losing records, pause/resume, owner switch, explicit deletion, desktop and phone. No paid resources.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: "/tmp/restyle-services-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
