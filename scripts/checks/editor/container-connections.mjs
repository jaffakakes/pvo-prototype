import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  taskFixture,
  hosted,
  control,
  expectStatus,
  inspect,
} from "../../../tests/service-actions/helpers.mjs";
import { NOW, ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
import { checkComponentTry } from "./component-try.mjs";
import { checkComponentDelivery } from "./component-delivery.mjs";
const fixture = await taskFixture({ services: true, clock: NOW });
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
const origin = ORIGIN,
  sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5319/";
let page;
const errors = [];
const requests = [];
try {
  await context.addInitScript((now) => {
    Date.now = () => now;
  }, NOW);
  await context.route(origin + "/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: new URL(url.pathname + url.search, sourceUrl).href,
    });
    await route.fulfill({ response });
  });
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route(
    /\/api\/(auth\/session|services(\/.*)?|assistant\/projects)$/,
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const body = req.postData() ? req.postDataJSON() : undefined;
      requests.push({ path: url.pathname, body });
      try {
        const reply = await fixture.request(url.pathname, {
          method: req.method(),
          body,
          headers: { Origin: origin },
        });
        await route.fulfill({ status: reply.status, json: reply.body });
      } catch {
        await route.fulfill({
          status: 503,
          json: { error: "Fixture restarting" },
        });
      }
    },
  );
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  await context.route("**/connection-fixture.mp4", (route) =>
    route.fulfill({ contentType: "video/mp4", body: media }),
  );
  async function ready(localId) {
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/" + (localId ? `?project=${localId}` : ""));
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
        window.resultProbe.storage.getProjectStorageStatus().phase ===
          "ready" &&
        (!id || window.resultProbe.useCapture.getState().localId === id),
      localId,
    );
  }
  await ready();
  const local = await page.evaluate(async () => {
    const { mkClip } = await import("/src/store.ts");
    const blob = await (await fetch("/connection-fixture.mp4")).blob();
    await (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Existing Container",
      ratio: "9:16",
      clips: [mkClip(3, URL.createObjectURL(blob), 0)],
    });
    const store = window.resultProbe.useCapture;
    const id = store.getState().addComponent("form");
    store.getState().updateComponent(id, {
      fields: {
        formFields: [{ name: "Guest", type: "text" }],
        heading: "Dinner",
        submitLabel: "Join",
        formSubmitMode: "local",
        outcome: { kind: "continue" },
      },
    });
    store.getState().patch({ sheet: "more" });
    await window.resultProbe.storage.saveProjectBeforeUpdate();
    return {
      id,
      localId: store.getState().localId,
      sceneId: store.getState().currentSceneId,
      past: store.getState().past.length,
    };
  });
  const service = await hosted({
    ...fixture,
    project: () => fixture.project(local.localId),
  });
  expectStatus(await control(fixture, service, "activate"), 200);
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to component", exact: true })
    .click();
  const connection = page.getByRole("region", {
    name: "Connect this Container",
    exact: true,
  });
  await connection
    .getByRole("combobox", { name: "Component", exact: true })
    .selectOption(JSON.stringify([local.sceneId, local.id]));
  await connection
    .getByRole("combobox", { name: "Published operation", exact: true })
    .selectOption("join");
  const mapping = connection.getByRole("combobox", {
    name: "Value for Input.name",
    exact: true,
  });
  await mapping.waitFor();
  assert((await mapping.inputValue()).startsWith("field:"));
  await connection
    .getByRole("button", { name: "Connect component", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-connection-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to component", exact: true })
    .click();
  await connection
    .getByRole("combobox", { name: "Component", exact: true })
    .selectOption(JSON.stringify([local.sceneId, local.id]));
  await connection
    .getByRole("combobox", { name: "Published operation", exact: true })
    .selectOption("join");
  await connection
    .getByRole("button", { name: "Connect component", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-connection-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await connection
    .getByRole("button", { name: "Connect component", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !!window.resultProbe.useCapture.getState().components[0]
        .serviceConnection,
  );
  const snapshot = await page.evaluate(() => {
    const s = window.resultProbe.useCapture.getState();
    return {
      past: s.past.length,
      connection: s.components[0].serviceConnection,
    };
  });
  assert.equal(snapshot.past, local.past + 1);
  assert.equal(
    snapshot.connection.receipt.identity.serviceId,
    service.identity.serviceId,
  );
  assert.equal(
    requests.filter((item) => item.path.endsWith("/attachment")).length,
    1,
  );
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().undo();
    if (
      window.resultProbe.useCapture.getState().components[0].serviceConnection
    )
      throw new Error("Undo did not remove connection");
    window.resultProbe.useCapture.getState().redo();
    window.resultProbe.useCapture.getState().patch({ sheet: null });
    await window.resultProbe.storage.saveProjectBeforeUpdate();
  });
  await page.close();
  await ready(local.localId);
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.resultProbe.useCapture.getState().components[0]
          .serviceConnection,
    ),
    snapshot.connection,
  );
  await checkComponentTry({
    context,
    fixture,
    origin,
    getPage: () => page,
    expectedLiveReleaseId: service.identity.resourceId,
    reopen: async () => {
      await page.close();
      await fixture.restart();
      await ready(local.localId);
    },
  });
  assert.deepEqual(
    (await inspect(fixture, service)).data
      .filter((row) => row.namespace === "live")
      .map((row) => JSON.parse(row.body).guests),
    [[]],
  );
  await checkComponentDelivery({
    context,
    fixture,
    origin,
    page,
    alreadyPublished: true,
  });
  await page.waitForFunction(
    async () =>
      (
        await import("/src/state/services/connectionSync.ts")
      ).useConnectionSync.getState().phase === "saved",
  );
  let dependencies = (
    await fixture.request(
      `/api/services/${service.identity.serviceId}/connections`,
    )
  ).body;
  assert.equal(
    dependencies.records.find((record) => record.report.kind === "project")
      .report.components.length,
    1,
  );
  assert.equal(
    dependencies.records.find((record) => record.report.kind === "export")
      .publications.length,
    1,
  );
  await page.evaluate(() =>
    window.resultProbe.useCapture.getState().patch({ sheet: "more" }),
  );
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connections and exports", exact: true })
    .click();
  const uses = page.getByRole("region", {
    name: "Container connections and exports",
    exact: true,
  });
  await uses
    .getByText("Project: Existing Container", { exact: true })
    .waitFor();
  await uses.locator("details").last().locator("summary").click();
  await uses.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-container-uses-desktop.png" });
  let removalReports = 0;
  const removalRoute = `**/api/services/${service.identity.serviceId}/connections`;
  const loseRemoval = async (route) => {
    const request = route.request(),
      body = request.postData() ? request.postDataJSON() : null;
    if (body?.kind === "project" && body.components.length === 0) {
      removalReports++;
      const saved = await fixture.request(new URL(request.url()).pathname, {
        body,
      });
      expectStatus(saved, 200);
      return route.abort("connectionfailed");
    }
    return route.fallback();
  };
  await context.route(removalRoute, loseRemoval);
  await page.evaluate(
    (id) => window.resultProbe.useCapture.getState().deleteComponent(id),
    local.id,
  );
  await uses
    .getByRole("button", { name: "Retry connection report", exact: true })
    .waitFor();
  await context.unroute(removalRoute, loseRemoval);
  await fixture.restart();
  await uses
    .getByRole("button", { name: "Retry connection report", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (
        await import("/src/state/services/connectionSync.ts")
      ).useConnectionSync.getState().phase === "saved",
  );
  assert.equal(
    removalReports,
    1,
    "Lost committed removal report recovers by read-back after restart",
  );
  dependencies = (
    await fixture.request(
      `/api/services/${service.identity.serviceId}/connections`,
    )
  ).body;
  assert.equal(
    dependencies.records.find((record) => record.report.kind === "project")
      .report.components.length,
    0,
  );
  assert.equal(
    dependencies.records.find((record) => record.report.kind === "export")
      .report.components.length,
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connections and exports", exact: true })
    .click();
  await uses
    .getByText("Project: Existing Container", { exact: true })
    .waitFor();
  await page.screenshot({ path: "/tmp/restyle-container-uses-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log(
    "Recorded project/export/published-link dependencies survive local removal; automatic saved reports and desktop/phone management view passed.",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Existing Container connection passed: actual controls/typed mapping, compiler, one Undo step, saved reload, real Try and interrupted replay, normal download and published cross-origin viewers. No model, workshop or paid resources.",
  );
} catch (error) {
  console.log(
    await page
      .locator('section[aria-label="Connect this Container"]')
      .ariaSnapshot({ timeout: 1000 })
      .catch(() => "no region"),
  );
  await page
    ?.screenshot({ path: "/tmp/restyle-connection-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
