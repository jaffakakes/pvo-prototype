import assert from "node:assert/strict";
import test from "node:test";
import { api, setup } from "./helpers.mjs";

test("connected export uses checked compiled source and projects only seven public fields", async () => {
  const f = await setup();
  const connections = api.exportServiceConnections(f.snapshot, f.languages);
  const scene = f.snapshot.scenes[0];
  const manifest = api.buildPvoManifest(
    f.snapshot,
    [{ scene, assetId: "video", name: "media/main.mp4", type: "video/mp4" }],
    f.languages,
    undefined,
    connections,
  );
  const publicValue = manifest.components[0].restyle_capture.service_connection;
  assert.deepEqual(Object.keys(publicValue).sort(), [
    "event",
    "input",
    "operation",
    "origin",
    "releaseId",
    "serviceId",
    "target",
  ]);
  const encoded = JSON.stringify(manifest);
  for (const privateField of [
    "ownerId",
    "projectId",
    "taskId",
    "reportDigest",
    "readiness",
    "receipt",
  ])
    assert(!encoded.includes(privateField), privateField);
  assert.equal(
    f.snapshot.services.releases[0].resourceId,
    publicValue.releaseId,
  );
});

test("foreign project, account or origin cannot prepare an attached export", async () => {
  const f = await setup();
  for (const change of [
    { ownerId: "other" },
    { localId: "other" },
    { origin: "https://other.example" },
  ])
    assert.throws(() =>
      api.prepareExportServices(f.snapshot, { ...f.scope, ...change }),
    );
});

test("changed compiled request or field type blocks packaging before rendering", async () => {
  const f = await setup();
  const compiled = f.languages.get("join").compiled;
  compiled.rules[0].action.url = "https://other.example";
  assert.throws(
    () => api.exportServiceConnections(f.snapshot, f.languages),
    /request changed/,
  );
  compiled.rules[0].action.url =
    f.snapshot.scenes[0].components[0].fields.outcome.url;
  compiled.structure.fields[0].kind = "number";
  assert.throws(() => api.exportServiceConnections(f.snapshot, f.languages));
  delete f.snapshot.services;
  assert.throws(
    () => api.exportServiceConnections(f.snapshot, f.languages),
    /owning account/,
  );
});

test("snapshot and completed artifact retain independent private delivery identity; flat video has none", async () => {
  const f = await setup();
  const captured = api.captureExportSnapshot(f.snapshot, "frozen");
  const result = { blob: new Blob(["file"]), name: "export.pvo" };
  const artifact = api.completedExport(captured, "pvo", result, "now");
  f.snapshot.services.ownerId = "changed";
  captured.services.localId = "changed";
  assert.equal(artifact.services.ownerId, f.identity.ownerId);
  assert.equal(artifact.services.localId, "local-one");
  assert.equal(
    api.completedExport(captured, "video", result, "now").services,
    undefined,
  );
});

test("activation retry retains the exact prepared file; reset releases it; stale result cannot enter the next project", async () => {
  const f = await setup();
  const artifact = api.completedExport(
    f.snapshot,
    "pvo",
    { blob: new Blob(["exact bytes"]), name: "export.pvo" },
    "now",
  );
  const url = URL.createObjectURL(artifact.blob);
  api.beginExportAttempt(artifact.snapshotId);
  assert(api.savePreparedExport(artifact, url));
  api.discardExportAttempt(artifact.snapshotId);
  assert.equal(api.useExportArtifact.getState().artifact, null);
  assert.equal(
    api.useExportArtifact.getState().prepared.artifact.blob,
    artifact.blob,
  );
  api.beginExportAttempt(artifact.snapshotId);
  assert(api.finishExportAttempt(artifact, url));
  assert.equal(api.useExportArtifact.getState().prepared, null);
  api.resetExportArtifact();
  assert.equal(api.useExportArtifact.getState().artifact, null);
  assert.equal(
    api.savePreparedExport(artifact, URL.createObjectURL(artifact.blob)),
    false,
  );
});
