import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import {
  taskFixture,
  expectStatus,
  ORIGIN,
} from "../../../tests/assistant-task-server/helpers.mjs";
import {
  draftContent,
  repairDecision,
} from "../../../tests/service-maintenance/helpers.mjs";
import { selectedTestRunner } from "../../../tests/service-maintenance/workshop.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";

const executions = [];
const f = await taskFixture({
  services: true,
  workspaces: true,
  planner: repairDecision,
  workspaceEffects: selectedTestRunner(executions),
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
let page,
  cookie = f.cookie,
  id,
  failHealth = false;
const errors = [];
try {
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route(
    /\/api\/(auth\/session|services(\/.*)?|assistant\/(projects|tasks(\/.*)?))$/,
    async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (failHealth && url.pathname.endsWith("/maintenance")) {
        await route.fulfill({
          status: 503,
          json: { error: "Health unavailable" },
        });
        return;
      }
      const result = await f.request(url.pathname, {
        method: req.method(),
        body: req.postData() ? req.postDataJSON() : undefined,
        session: cookie,
        headers: { Origin: ORIGIN },
      });
      await route.fulfill({ status: result.status, json: result.body });
    },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(20000);
  const sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5327/";
  await page.goto(sourceUrl);
  await page
    .getByRole("button", { name: "Blank project", exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.has("project"));
  await page.evaluate(async () => {
    window.maintenanceProbe = {
      storage: (await import("/src/app/projectAutosave.ts"))
        .getProjectStorageStatus,
      auth: await import("/src/state/auth/authGateStore.ts"),
    };
    await window.maintenanceProbe.auth.refreshAccountSession();
  });
  await page.waitForFunction(
    () => window.maintenanceProbe.storage().phase === "ready",
  );
  await page.locator("#root[inert]").waitFor({ state: "hidden" });
  const project = await f.project(
    new URL(page.url()).searchParams.get("project"),
  );
  expectStatus(project, 200);
  const created = await f.request("/api/services", {
    body: {
      actionId: randomUUID(),
      projectId: project.body.project.id,
      description: "Capacity service",
    },
  });
  expectStatus(created, 200);
  id = created.body.draft.identity.serviceId;
  expectStatus(
    await f.request(`/api/services/${id}/draft`, {
      body: {
        actionId: randomUUID(),
        expectedRevision: 0,
        content: { ...created.body.draft.content, ...draftContent(true) },
      },
    }),
    200,
  );
  async function open() {
    if (page.viewportSize().width >= 900) {
      await page
        .getByRole("button", { name: "Project settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "More settings", exact: true })
        .click();
    } else
      await page
        .locator("header")
        .getByRole("button", { name: "More", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Open Containers", exact: true })
      .click();
  }
  await open();
  await page.getByText("Capacity service", { exact: true }).waitFor();
  await page.getByText("Container health", { exact: true }).click();
  await page
    .getByText("No operational problem was found", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByLabel("Changes to this Container")
    .fill(
      "The capacity rule lets one extra person join. Repair it and preserve existing records.",
    );
  await page
    .getByRole("button", { name: "Investigate and repair", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Saved investigation" })
    .getByText(
      "Checked repair saved. Refresh Containers to review and publish it.",
      { exact: false },
    )
    .waitFor();
  assert.deepEqual(executions, [0, 1, 0]);
  await page
    .getByRole("button", { name: "Refresh saved code", exact: true })
    .click();
  await page.getByText("Saved draft · revision 3", { exact: true }).waitFor();
  const summary = (await f.request(`/api/services/${id}`)).body.summary;
  assert.equal(summary.service.liveReleaseId, null);
  assert.ok(summary.service.testReleaseId);
  await page
    .getByRole("region", { name: "Saved investigation" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-4-repair-desktop.png" });
  // Lost health requests keep the previous issue status and provide a specific retry.
  failHealth = true;
  await page
    .getByRole("button", { name: "Refresh health", exact: true })
    .click();
  await page
    .getByText("Couldn’t check this Container.", { exact: false })
    .waitFor();
  failHealth = false;
  await page
    .getByRole("button", { name: "Refresh health", exact: true })
    .click();
  await page
    .getByText("Couldn’t check this Container.", { exact: false })
    .waitFor({ state: "hidden" });
  await f.restart();
  await page.reload();
  await page.evaluate(async () => {
    window.maintenanceProbe = {
      storage: (await import("/src/app/projectAutosave.ts"))
        .getProjectStorageStatus,
      auth: await import("/src/state/auth/authGateStore.ts"),
    };
    await window.maintenanceProbe.auth.refreshAccountSession();
  });
  await page.waitForFunction(
    () => window.maintenanceProbe.storage().phase === "ready",
  );
  await page.locator("#root[inert]").waitFor({ state: "hidden" });
  await open();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByRole("region", { name: "Saved investigation" })
    .getByText("The new test caught the original problem.", { exact: false })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await page
    .getByRole("region", { name: "Saved investigation" })
    .getByText("Checked repair saved", { exact: false })
    .waitFor();
  await page
    .getByRole("region", { name: "Saved investigation" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-4-repair-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  cookie = f.otherCookie;
  await page.evaluate(() =>
    window.maintenanceProbe.auth.refreshAccountSession(),
  );
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Saved investigation" }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Actual creator desktop/phone: scoped health, repair request, original-fail/repaired-pass tests, independent checks, saved same-draft result, unpublished checked release, health failure/retry, full worker/browser restart, owner replacement and no overflow passed.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: "/tmp/restyle-4-maintenance-browser-failure.png" })
    .catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await context.close();
  await browser.close();
  await f.close();
}
