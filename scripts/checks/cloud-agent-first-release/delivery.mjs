import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";
import { fillGeneratedForm, openIndependentViewer } from "./viewer.mjs";
import { publishGeneratedArtifact } from "./publication.mjs";

const projected = (value, path) =>
  path.reduce((value, key) => value?.[key], value);

/** Inputs are chosen after reviewing the actual generated agreement; no generated code is replaced. */
export async function checkGeneratedDelivery({
  journey,
  subject,
  snapshot,
  plan,
  record,
  directory,
  call,
}) {
  const session = await journey.apply(subject, snapshot);
  const { page, context } = session;
  const connection = await page.evaluate(
    () =>
      window.resultProbe.useCapture.getState().components[0].serviceConnection,
  );
  const identity = connection.receipt.identity;
  const base = `/api/services/${identity.serviceId}`;
  const expectResult = (body, expected) =>
    assert.deepEqual(projected(body.result, plan.resultPath), expected);
  const api = (path, method, body) => journey.api(subject, path, method, body);
  const info = await api(base);
  assert.equal(info.status, 200);
  const other = await journey.api(
    subject === "dinner" ? "equipment" : "dinner",
    base,
  );
  assert.ok(
    [403, 404, 410].includes(other.status),
    "Another owner must not read the service",
  );

  // Exercise the actual Try UI and server-authorized component-test route.
  await page.evaluate(async () => {
    const state = window.resultProbe.useCapture.getState();
    state.patch({ t: 0 });
    (await import("/src/features/preview/tryMode.ts")).startTry();
    window.resultProbe.useCapture.getState().patch({ playing: false });
  });
  const tryReply = page.waitForResponse(
    (response) =>
      response.url().endsWith("/try") && response.request().method() === "POST",
  );
  await fillGeneratedForm(
    page
      .locator('.compCustomRuntime iframe[sandbox="allow-same-origin"]')
      .first()
      .contentFrame(),
    plan.testFields,
  );
  const tried = await tryReply;
  assert.equal(tried.status(), 200);
  expectResult(await tried.json(), plan.accepted);
  const tryBody = tried.request().postDataJSON();
  const foreignTry = await journey.api(
    subject === "dinner" ? "equipment" : "dinner",
    base + `/releases/${identity.resourceId}/try`,
    "POST",
    tryBody,
  );
  assert.ok([403, 404, 410].includes(foreignTry.status));
  const forged = await api(
    base + `/releases/${identity.resourceId}/try`,
    "POST",
    { ...tryBody, mode: "live" },
  );
  assert.equal(forged.status, 400);
  await record("owner_and_test_authority", {
    subject,
    foreignRead: other.status,
    foreignTry: foreignTry.status,
    forgedMode: forged.status,
  });
  await page.evaluate(async () =>
    (await import("/src/features/preview/tryMode.ts")).stopTry(),
  );

  // Lose the real committed activation reply. Retry must retain the prepared file.
  const activationBodies = [];
  let loseActivation = true;
  await context.route(journey.origin + base + "/activate", async (route) => {
    const body = route.request().postDataJSON();
    activationBodies.push(body);
    const result = await api(base + "/activate", "POST", body);
    assert.equal(result.status, 200);
    if (loseActivation) {
      loseActivation = false;
      await route.abort("connectionfailed");
    } else await route.fulfill({ status: result.status, json: result.body });
  });
  await page.evaluate(async () =>
    (await import("/src/state/export/exportCommands.ts")).requestExport(),
  );
  await page
    .getByRole("dialog", { name: "Export", exact: true })
    .getByRole("button", { name: /Export and share/ })
    .click();
  await page
    .getByRole("heading", { name: "Export failed", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    window.deliveryArtifact = (
      await import("/src/state/export/exportArtifactStore.ts")
    ).useExportArtifact.getState().prepared.artifact;
  });
  await call(`/${subject}/restart`, "POST");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const share = page.locator("[data-share-panel]");
  await share.waitFor();
  assert(
    await page.evaluate(
      async () =>
        (
          await import("/src/state/export/exportArtifactStore.ts")
        ).useExportArtifact.getState().artifact === window.deliveryArtifact,
    ),
  );
  for (const body of activationBodies)
    assert.deepEqual(body, activationBodies[0]);
  const downloadEvent = page.waitForEvent("download");
  await share.locator("[data-download-again]").click();
  const download = await downloadEvent;
  assert.equal(await download.failure(), null);
  const bytes = await readFile(await download.path());
  await writeFile(`${directory}/${subject}.pvo`, bytes, { mode: 0o600 });
  const exported = await readPvoProject(new Blob([bytes]));
  assert.equal(exported.validation.valid, true);
  const descriptor =
    exported.manifest.components[0].restyle_capture.service_connection;
  assert.equal(descriptor.releaseId, identity.resourceId);
  assert.equal(descriptor.serviceId, identity.serviceId);
  for (const privateField of [
    "ownerId",
    "reportDigest",
    "readiness",
    "receipt",
  ])
    assert(!JSON.stringify(descriptor).includes(privateField));
  await record("interrupted_export_recovered", {
    subject,
    activationBodies,
    descriptor,
    bytes: bytes.length,
  });
  const publication = await publishGeneratedArtifact({
    context,
    page,
    origin: journey.origin,
    subject,
    bytes,
    record,
  });
  await page.close();

  const viewer = await openIndependentViewer(
    journey.browser,
    bytes,
    publication,
  );
  let viewerAction, firstResult, publishedAction;
  try {
    const actionReply = viewer.page.waitForResponse(
      (response) =>
        response.url().endsWith("/actions") &&
        response.request().method() === "POST",
    );
    await fillGeneratedForm(viewer.frame, plan.viewerFields);
    const response = await actionReply;
    assert.equal(response.status(), 200);
    assert.equal((await response.request().allHeaders()).cookie, undefined);
    viewerAction = response.request().postDataJSON();
    firstResult = await response.json();
    expectResult(firstResult, plan.accepted);
    const publicAction = async (body) => {
      const response = await fetch(journey.origin + base + "/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json() };
    };
    const replay = await publicAction(viewerAction);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, firstResult);
    const operation = viewerAction.operation;
    for (const [index, example] of plan.cases.entries()) {
      const result = await publicAction({
        actionId: `acceptance-${subject}-case-${index}`,
        operation,
        input: example.input,
      });
      assert.equal(result.status, example.status ?? 200);
      if (result.status === 200) expectResult(result.body, example.expected);
      await record("public_case", {
        subject,
        index,
        input: example.input,
        ...result,
      });
    }
    const raced = await Promise.all(
      plan.raceInputs.map((input, index) =>
        publicAction({
          actionId: `acceptance-${subject}-race-${index}`,
          operation,
          input,
        }),
      ),
    );
    assert(raced.every((result) => result.status === 200));
    assert.deepEqual(
      raced
        .map((result) =>
          JSON.stringify(projected(result.body.result, plan.resultPath)),
        )
        .sort(),
      [plan.accepted, plan.rejected]
        .map((value) => JSON.stringify(value))
        .sort(),
    );
    await record("separate_viewer_and_concurrency", {
      subject,
      firstResult,
      replay,
      viewerAction,
      raced,
      creatorClosed: page.isClosed(),
      workshopsAbsent: snapshot.workspaces.every((w) => w.absent),
    });
    const publishedFrame = await viewer.openPublished();
    const publishedReply = viewer.page.waitForResponse(
      (response) =>
        response.url().endsWith("/actions") &&
        response.request().method() === "POST",
    );
    await fillGeneratedForm(publishedFrame, plan.publishedFields);
    const published = await publishedReply;
    assert.equal(published.status(), 200);
    assert.equal((await published.request().allHeaders()).cookie, undefined);
    const publishedResult = await published.json();
    publishedAction = published.request().postDataJSON();
    expectResult(publishedResult, plan.publishedExpected);
    await record("published_viewer", {
      subject,
      publishedResult,
      creatorClosed: page.isClosed(),
      storage: "controlled fixture",
      service: "real cloud provider",
    });
    assert.deepEqual(viewer.errors, []);
  } finally {
    await viewer.close();
  }

  // Removing local controls does not delete the independently hosted service or its data.
  const reopened = await journey.reopen(session);
  await reopened.evaluate(async () => {
    const state = window.resultProbe.useCapture.getState();
    state.deleteComponent(state.components[0].id);
    await window.resultProbe.storage.saveProjectBeforeUpdate();
  });
  assert.equal(
    await reopened.evaluate(
      () => window.resultProbe.useCapture.getState().components.length,
    ),
    0,
  );
  const retained = await api(base);
  assert.equal(retained.status, 200);
  assert.equal(
    retained.body.summary.service.liveReleaseId,
    identity.resourceId,
  );
  const retainedReply = await fetch(journey.origin + base + "/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(viewerAction),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(retainedReply.status, 200);
  assert.deepEqual(await retainedReply.json(), firstResult);
  const afterRemoval = await fetch(journey.origin + base + "/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...publishedAction,
      actionId: `acceptance-after-removal-${subject}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(afterRemoval.status, 200);
  const retainedRecords = await afterRemoval.json();
  expectResult(retainedRecords, plan.publishedExpected);
  await reopened.evaluate(() =>
    window.resultProbe.useCapture.getState().patch({ sheet: "more" }),
  );
  await reopened
    .getByRole("button", { name: "Manage services", exact: true })
    .click();
  await reopened.getByText("Service details", { exact: true }).click();
  await reopened
    .getByText(/Undo in the editor does not undo viewer submissions/)
    .waitFor();
  await reopened
    .getByRole("button", { name: "Pause service", exact: true })
    .waitFor();
  await record("local_removal_keeps_hosted_service", {
    subject,
    summary: retained.body.summary,
    retainedRecords,
  });
  await reopened.screenshot({
    path: `${directory}/${subject}-service-management.png`,
  });
  await reopened.close();
  return { identity, descriptor, viewerAction };
}
