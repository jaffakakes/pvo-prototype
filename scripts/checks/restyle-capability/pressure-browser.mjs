import { checkPressureViewer } from "./pressure-viewer.mjs";
import assert from "node:assert/strict";
import { fillGeneratedForm } from "../cloud-agent-first-release/viewer.mjs";
import { exportGenerated } from "./durable-delivery.mjs";
import { expectStatus } from "../../../tests/assistant-task-server/helpers.mjs";
import { control } from "../../../tests/service-actions/helpers.mjs";

/** Synthetic creator approval uses the canonical receipt identity, then publishes that exact release. */
export async function approvePressureEmail(fixture, saved, record) {
  const identity = saved.receipt.identity;
  assert.equal(saved.connection.releaseId, identity.resourceId);
  expectStatus(
    await fixture.request(
      `/api/services/${identity.serviceId}/account-access`,
      {
        body: { kind: "approve", releaseId: identity.resourceId },
      },
    ),
    200,
  );
  expectStatus(await control(fixture, { identity }, "activate"), 200);
  await record("controlled_creator_approval", {
    serviceId: identity.serviceId,
    releaseId: identity.resourceId,
  });
}

/** Real generated UI, Try, export, anonymous mobile viewer and retained receipt. No source repair. */
export async function checkPressureBrowser(
  creator,
  fixture,
  directory,
  record,
  email,
  scenario,
) {
  const applied = await creator.apply();
  const form = applied.components.find((item) => item.type === "form");
  assert.ok(
    form?.serviceConnection,
    "A generated form must attach its checked operation.",
  );
  const page = creator.page;
  await page.evaluate(async () => {
    window.resultProbe.useCapture.getState().patch({ t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    window.resultProbe.useCapture.getState().patch({ playing: false });
  });
  const tryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/try") && response.request().method() === "POST",
  );
  await fillGeneratedForm(
    page
      .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame(),
    scenario.inputs.at(-1),
  );
  const tried = await tryResponse;
  assert.equal(tried.status(), 200);
  await record("try_response", {
    body: await tried.json(),
    providerCalls: email?.calls.length ?? 0,
  });
  assert.equal(email?.calls.length ?? 0, 0);
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );
  if (email) {
    await approvePressureEmail(fixture, form.serviceConnection, record);
  }
  const bytes = await exportGenerated(page, directory, record);
  await checkPressureViewer(
    creator,
    fixture,
    bytes,
    directory,
    record,
    email,
    scenario,
  );
  assert.deepEqual(creator.errors, []);
}
