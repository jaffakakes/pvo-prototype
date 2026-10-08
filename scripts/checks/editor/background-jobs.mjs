import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  hosted,
  control,
  expectStatus,
  inspect,
} from "../../../tests/service-actions/helpers.mjs";
import { fixture as accountFixture } from "../../../tests/account-connections/helpers.mjs";
import { NOW, ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import {
  emailProvider,
  EMAIL_KEY,
  WEBHOOK_SECRET,
  emailSetup,
} from "../../../tests/service-jobs/email.fixture.mjs";
import { checkedAcceptance } from "../../../tests/service-jobs/acceptance.fixture.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
import { checkBackgroundDelivery } from "./background-delivery.mjs";

// Real creator commands, compiler/Try, HTTP and SQLite; the outside email provider is controlled.
const email = emailProvider(),
  fixture = await accountFixture({
    services: true,
    connectionFetch: email.fetch,
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
  cookie = fixture.cookie;
const errors = [];
try {
  const sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5326/";
  await context.route(ORIGIN + "/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: new URL(url.pathname + url.search, sourceUrl).href,
      }),
    });
  });
  await installAssistantAvailabilityFixture(context);
  await context.route("**/api/publishing", (route) =>
    route.fulfill({
      json: { available: false, hasSession: false, maxBytes: 0 },
    }),
  );
  await context.route(
    /\/api\/(auth\/session|account-connections(\/.*)?|services(\/.*)?|assistant\/projects)$/,
    async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const result = await fixture.request(url.pathname, {
        method: req.method(),
        body: req.postData() ? req.postDataJSON() : undefined,
        session: cookie,
        headers: {
          Origin: ORIGIN,
          "X-Restyle-Owner": req.headers()["x-restyle-owner"] ?? "",
        },
      });
      await route.fulfill({ status: result.status, json: result.body });
    },
  );
  const media = await readFile(
    new URL("../../../share/assets/preview.mp4", import.meta.url),
  );
  await context.route("**/background-fixture.mp4", (route) =>
    route.fulfill({ contentType: "video/mp4", body: media }),
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(ORIGIN + "/");
  await page
    .getByRole("button", { name: "Blank project", exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.has("project"));
  await page.evaluate(async () => {
    window.backgroundAcceptance = {
      storage: (await import("/src/app/projectAutosave.ts"))
        .getProjectStorageStatus,
      capture: (await import("/src/state/captureStore.ts")).useCapture,
      preview: await import("/src/features/preview/tryMode.ts"),
    };
  });
  await page.waitForFunction(
    () => window.backgroundAcceptance.storage().phase === "ready",
  );
  await page.locator("#root[inert]").waitFor({ state: "hidden" });
  const local = await page.evaluate(async () => {
    await (
      await import("/src/state/auth/authGateStore.ts")
    ).refreshAccountSession();
    const { mkClip } = await import("/src/store.ts"),
      { useCapture } = await import("/src/state/captureStore.ts");
    const blob = await (await fetch("/background-fixture.mp4")).blob();
    const state = useCapture.getState(),
      clips = [mkClip(3, URL.createObjectURL(blob), 0)];
    state.patch({
      projectName: "Acceptance messages",
      ratio: "9:16",
      clips,
      scenes: state.scenes.map((scene) =>
        scene.id === state.currentSceneId ? { ...scene, clips } : scene,
      ),
    });
    const id = useCapture.getState().addComponent("form");
    useCapture.getState().updateComponent(id, {
      fields: {
        formFields: [{ name: "Guest", type: "text" }],
        heading: "Accept invitation",
        submitLabel: "Accept",
        formSubmitMode: "local",
        outcome: { kind: "continue" },
      },
    });
    await (
      await import("/src/app/projectAutosave.ts")
    ).saveProjectBeforeUpdate();
    useCapture.getState().patch({ sheet: "more" });
    return {
      id,
      sceneId: useCapture.getState().currentSceneId,
      localId: useCapture.getState().localId,
    };
  });
  await page
    .getByRole("button", { name: "Manage connections", exact: true })
    .click();
  const manager = page.getByRole("region", {
    name: "Account connections",
    exact: true,
  });
  await manager
    .getByRole("button", { name: "Connect email sender", exact: true })
    .click();
  await manager
    .getByLabel("Verified sending address", { exact: true })
    .fill(emailSetup.from);
  await manager
    .getByLabel("Approved recipient", { exact: true })
    .fill(emailSetup.recipient);
  await manager
    .getByLabel("Private Resend API key", { exact: true })
    .fill(EMAIL_KEY);
  await manager
    .getByLabel("Delivery update signing secret (optional)", { exact: true })
    .fill(WEBHOOK_SECRET);
  await page.screenshot({ path: "/tmp/restyle-3-email-form-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Manage connections", exact: true })
    .click();
  await manager
    .getByRole("button", { name: "Connect email sender", exact: true })
    .click();
  await manager
    .getByLabel("Verified sending address", { exact: true })
    .fill(emailSetup.from);
  await manager
    .getByLabel("Approved recipient", { exact: true })
    .fill(emailSetup.recipient);
  await manager
    .getByLabel("Private Resend API key", { exact: true })
    .fill(EMAIL_KEY);
  await manager
    .getByLabel("Delivery update signing secret (optional)", { exact: true })
    .fill(WEBHOOK_SECRET);
  await manager
    .getByLabel("Verified sending address", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-3-email-form-phone.png" });
  await manager
    .getByRole("button", { name: "Connect email sender", exact: true })
    .click();
  await manager
    .getByText("Connected · email sending allowed", { exact: false })
    .waitFor();
  assert.equal(await manager.locator('input[type="password"]').count(), 0);
  const connectionId = (await fixture.list()).body.items[0].connection.id;
  const checked = await checkedAcceptance({ connectionId });
  const service = await hosted(
    { ...fixture, project: () => fixture.project(local.localId) },
    { checked },
  );
  const path = `/api/services/${service.identity.serviceId}`;
  expectStatus(
    await fixture.request(path + "/account-access", {
      body: { kind: "approve", releaseId: service.identity.resourceId },
    }),
    200,
  );
  expectStatus(await control(fixture, service, "activate"), 200);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () =>
    (await import("/src/state/captureStore.ts")).useCapture
      .getState()
      .patch({ sheet: "more" }),
  );
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to component", exact: true })
    .click();
  const attach = page.getByRole("region", {
    name: "Connect this Container",
    exact: true,
  });
  await attach
    .getByRole("combobox", { name: "Component", exact: true })
    .selectOption(JSON.stringify([local.sceneId, local.id]));
  await attach
    .getByRole("combobox", { name: "Published operation", exact: true })
    .selectOption("accept");
  await attach
    .getByRole("button", { name: "Connect component", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !!window.backgroundAcceptance.capture.getState().components[0]
        .serviceConnection,
  );
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().patch({ sheet: null, t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    useCapture.getState().patch({ playing: false });
  });
  const frame = page
    .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
    .first()
    .contentFrame();
  await frame.getByRole("textbox").fill("Try guest");
  await frame.getByRole("button", { name: "Accept", exact: true }).click();
  await page.waitForFunction(() =>
    Object.values(
      window.backgroundAcceptance.preview.getTryRuntime()?.state.responses ??
        {},
    ).some(
      (value) =>
        value.job?.status === "confirmed" && value.job.result === "accepted",
    ),
  );
  assert.equal(email.sends, 0);
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );
  await checkBackgroundDelivery({ context, page, service });
  const submit = (id, schedule = null) =>
    fixture.request(path + "/jobs", {
      session: null,
      body: {
        releaseId: service.identity.resourceId,
        action: {
          actionId: id,
          operation: "accept",
          input: { name: "Live guest" },
        },
        receiptKey: "e".repeat(64),
        schedule,
      },
    });
  expectStatus(await submit("live-acceptance"), 202);
  expectStatus(
    await submit("cancel-later", {
      at: NOW + 3600000,
      timezone: "Europe/London",
    }),
    202,
  );
  email.lost = true;
  const sweep = () =>
    fixture.control({
      action: "host-diagnostic",
      identity: service.identity,
      kind: "sweep",
    });
  await sweep();
  assert.equal(email.sends, 1);
  await page.evaluate(async (id) => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().deleteComponent(id);
    useCapture.getState().patch({ sheet: "more" });
  }, local.id);
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  const jobs = page.getByRole("region", {
    name: "Background work",
    exact: true,
  });
  await jobs
    .getByRole("button", { name: "Check saved action", exact: true })
    .waitFor();
  await jobs.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-3-jobs-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Records and usage", exact: true })
    .click();
  await jobs
    .locator("li")
    .first()
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/tmp/restyle-3-jobs-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await jobs
    .getByRole("button", { name: "Cancel queued request", exact: true })
    .click();
  await jobs
    .getByText("Cancelled before completion", { exact: true })
    .waitFor();
  await fixture.restart();
  await jobs
    .getByRole("button", { name: "Check saved action", exact: true })
    .click();
  await sweep();
  await jobs
    .getByRole("button", { name: "Refresh background work", exact: true })
    .click();
  await jobs
    .getByText("Email accepted by sender; delivery pending", { exact: true })
    .waitFor();
  assert.equal(email.sends, 1);
  const evidence = (await fixture.request(path + "/jobs")).body.jobs;
  assert.equal(evidence.length, 2);
  assert.equal(
    (await inspect(fixture, service)).data
      .filter((row) => row.namespace === "live")
      .map((row) => JSON.parse(row.body).guests)[0][0],
    "Live guest",
  );
  cookie = fixture.otherCookie;
  await page.evaluate(async () =>
    (await import("/src/state/auth/authGateStore.ts")).refreshAccountSession(),
  );
  await page.getByText("No Containers yet.", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Background work", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Creator background work passed: private Resend setup/cleared secrets, checked service attachment, actual compiled iframe Try with zero sends, local component deletion preserves jobs, failure inspection, same-action recovery after restart, scheduled cancellation, owner change and desktop/phone.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: "/tmp/restyle-3-creator-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
