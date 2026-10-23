import { checkConnectedRecovery } from "./connected-recovery.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import {
  fixture as accountFixture,
  provider,
  connectInput,
} from "../../../tests/account-connections/helpers.mjs";
import {
  hosted,
  control,
  expectStatus,
  publicCall,
} from "../../../tests/service-actions/helpers.mjs";
import {
  dinnerAgreement,
  dinnerSource,
} from "../../../tests/service-validation/fixtures.mjs";
import { readAdapter } from "../../../tests/connected-services/fixtures.mjs";
import { ORIGIN } from "../../../tests/assistant-task-server/helpers.mjs";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
import { checkComponentTry } from "./component-try.mjs";
import { checkComponentDelivery } from "./component-delivery.mjs";

const api = provider();
const providerState = { writes: 0, found: false, created: null };
let reads = 0;
const fixture = await accountFixture({
  services: true,
  connectionFetch: async (request) => {
    if (request.method === "POST") {
      providerState.writes++;
      providerState.created = {
        ...(await request.json()),
        number: 42,
        user: { login: "octocat" },
      };
      return Response.json(
        { message: "controlled lost reply" },
        { status: 503 },
      );
    }
    if (new URL(request.url).searchParams.has("creator"))
      return Response.json(providerState.found ? [providerState.created] : []);
    if (new URL(request.url).pathname.endsWith("/issues/7")) {
      reads++;
      return Response.json({ title: "accepted", privateSurplus: "excluded" });
    }
    return api.fetch(request);
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
let page;
try {
  await context.route(ORIGIN + "/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: new URL(
          url.pathname + url.search,
          process.env.EDITOR_URL || "http://127.0.0.1:5323/",
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
  await context.route(
    /\/api\/(auth\/session|services(\/.*)?|assistant\/projects|account-connections(\/.*)?)$/,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const result = await fixture.request(url.pathname, {
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : undefined,
        headers: {
          Origin: ORIGIN,
          "X-Restyle-Owner": request.headers()["x-restyle-owner"] ?? "",
        },
      });
      await route.fulfill({ status: result.status, json: result.body });
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
    await page.goto(ORIGIN + "/" + (localId ? `?project=${localId}` : ""));
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
  await ready();
  const local = await page.evaluate(async () => {
    const { mkClip } = await import("/src/store.ts");
    const blob = await (await fetch("/connection-fixture.mp4")).blob();
    await (
      await import("/src/features/create-project/projectCommands.ts")
    ).createProject({
      name: "Connected Container",
      ratio: "9:16",
      clips: [mkClip(3, URL.createObjectURL(blob), 0)],
    });
    const store = window.resultProbe.useCapture;
    const id = store.getState().addComponent("form");
    store.getState().updateComponent(id, {
      fields: {
        formFields: [{ name: "Guest", type: "text" }],
        heading: "Connected action",
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
    };
  });
  expectStatus(await fixture.connection("connect", connectInput()), 200);
  const agreement = dinnerAgreement();
  agreement.connections = [
    {
      name: "issue",
      connectionId: "connection-one",
      operations: ["join"],
      adapter: readAdapter(),
      examples: [{ input: { number: 7 }, result: { title: "accepted" } }],
    },
  ];
  for (const scenario of agreement.cases)
    for (const step of scenario.steps)
      step.requests =
        step.operation === "join"
          ? [{ connection: "issue", input: { number: 7 } }]
          : [];
  const source =
    dinnerSource.replace("export function execute", "function localExecute") +
    `\nexport function execute(invocation) {
    if (invocation.operation === 'join') {
      if (!invocation.connectionResults?.length) return { request: { connection: 'issue', input: { number: 7 } } };
      if (invocation.connectionResults[0].result.title !== 'accepted') return { result: 'full', state: invocation.state };
    }
    return localExecute(invocation);
  }`;
  const service = await hosted(
    { ...fixture, project: () => fixture.project(local.localId) },
    { agreement, source },
  );
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  const access = page.getByRole("region", {
    name: "Checked version account access",
    exact: true,
  });
  await page
    .locator("summary")
    .filter({ hasText: "Checked version account access" })
    .click();
  await access
    .getByRole("button", { name: "Approve this version’s access", exact: true })
    .waitFor();
  await access.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2c-access-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open Containers", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Checked version account access" })
    .click();
  await access
    .getByRole("button", { name: "Approve this version’s access", exact: true })
    .waitFor();
  await access.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/restyle-2c-access-phone.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await access
    .getByRole("button", { name: "Approve this version’s access", exact: true })
    .click();
  await access.getByText(/Approved for this version/).waitFor();
  await page
    .getByRole("button", { name: "Publish checked version", exact: true })
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
    .selectOption("join");
  await attach
    .getByRole("button", { name: "Connect component", exact: true })
    .click();
  await page.waitForFunction(() =>
    Boolean(
      window.resultProbe.useCapture.getState().components[0].serviceConnection,
    ),
  );
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().patch({ sheet: null });
    await window.resultProbe.storage.saveProjectBeforeUpdate();
  });
  await checkComponentTry({
    context,
    fixture,
    origin: ORIGIN,
    getPage: () => page,
    expectedLiveReleaseId: service.identity.resourceId,
    reopen: async () => {
      await page.close();
      await fixture.restart();
      await ready(local.localId);
    },
  });
  assert.equal(
    reads,
    0,
    "Normal Try and replay never contact the outside account",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkComponentDelivery({
    context,
    fixture,
    origin: ORIGIN,
    page,
    alreadyPublished: true,
  });
  assert(
    reads > 0,
    "A separate viewer must reach the controlled provider through the Node host",
  );
  const before = reads;
  expectStatus(
    await fixture.request(
      `/api/services/${service.identity.serviceId}/account-access`,
      { body: { kind: "revoke", releaseId: service.identity.resourceId } },
    ),
    200,
  );
  expectStatus(
    await publicCall(fixture, service, {
      actionId: "after-revocation",
      operation: "join",
      input: { name: "Blocked" },
    }),
    403,
  );
  assert.equal(reads, before);
  await checkConnectedRecovery({ page, fixture, local, providerState });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      viewports: [1440, 390],
      approval: "actual creator UI",
      TryOutsideCalls: 0,
      provider: "controlled GitHub",
      runtime: "real local Node",
      separateViewer: true,
      revoked: true,
      workshop: "never started",
    }),
  );
} finally {
  await context.close();
  await browser.close();
  await fixture.close();
}
