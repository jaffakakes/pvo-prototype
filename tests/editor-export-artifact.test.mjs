import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { contents: `
  export { captureExportSnapshot, publicationInput } from "./editor/src/domain/publishing/exportSnapshot.ts";
  export { renderCompletedExport } from "./editor/src/features/export/exportWorkflow.ts";
  export { useExportArtifact, beginExportAttempt, finishExportAttempt, setExportPublication, beginPublicationAttempt, forgetExportPublication, resetExportArtifact } from "./editor/src/state/export/exportArtifactStore.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { captureExportSnapshot, publicationInput, renderCompletedExport, useExportArtifact,
  beginExportAttempt, finishExportAttempt, setExportPublication, beginPublicationAttempt, forgetExportPublication, resetExportArtifact } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function project() {
  return { currentSceneId: "main", ratio: "9:16", quality: "720p", allowedDomains: ["example.com"], scenes: [{
    id: "main", name: "Main", parent: null, clips: [{ id: 1, url: "blob:original", in: 0, out: 2, speed: 1, zoom: 1, mirror: false, color: "#000" }],
    texts: [{ id: 1, text: "Original", start: 0, end: 2, style: { color: "#fff" } }], components: [], layers: ["video", "text:1"], muted: true, sound: 0,
  }] };
}
function adapters(overrides = {}) {
  const output = new Blob(["completed exact bytes"], { type: "video/webm" });
  const events = [];
  return { events, output, value: {
    video: async source => { events.push(["video", source]); return { blob: output, url: "blob:completed", name: "video.webm" }; },
    pvo: async source => { events.push(["pvo", source]); return { blob: output, url: "blob:completed", name: "video.pvo" }; },
    readMedia: async url => { events.push(["read", url]); return new Blob(["source bytes"]); },
    createUrl: () => "blob:leased", revokeUrl: url => events.push(["revoke", url]), now: () => "2026-09-27T12:00:00Z", ...overrides,
  } };
}

test("export snapshots detach clips, content, domains and settings from later edits", () => {
  const input = project();
  const snapshot = captureExportSnapshot(input, "snapshot-one");
  input.scenes[0].texts[0].text = "Edited later";
  input.scenes[0].clips[0].out = 7;
  input.allowedDomains.push("other.example");
  input.quality = "1080p";
  assert.equal(snapshot.scenes[0].texts[0].text, "Original");
  assert.equal(snapshot.scenes[0].clips[0].out, 2);
  assert.deepEqual(snapshot.allowedDomains, ["example.com"]);
  assert.equal(snapshot.quality, "720p");
});

test("flat exports render once from leased snapshot inputs and preserve the returned Blob", async () => {
  const snapshot = captureExportSnapshot(project(), "snapshot-one");
  const fixture = adapters();
  const result = await renderCompletedExport(snapshot, "video", () => {}, fixture.value);
  assert.equal(result.artifact.blob, fixture.output);
  assert.equal(result.artifact.snapshotId, "snapshot-one");
  assert.equal(result.artifact.format, "video");
  assert.equal(result.artifact.contentType, "video/webm");
  assert.equal(fixture.events.filter(([event]) => event === "video").length, 1);
  assert.equal(fixture.events.find(([event]) => event === "video")[1].clips[0].url, "blob:leased");
  assert.equal(snapshot.scenes[0].clips[0].url, "blob:original");
  assert.deepEqual(fixture.events.at(-1), ["revoke", "blob:leased"]);
  assert.equal(result.url, "blob:completed");
});

test("PVO export keeps its chosen format and does not invoke the flat renderer", async () => {
  const fixture = adapters();
  const result = await renderCompletedExport(captureExportSnapshot(project(), "snapshot-pvo"), "pvo", () => {}, fixture.value);
  assert.equal(fixture.events.filter(([event]) => event === "pvo").length, 1);
  assert.equal(fixture.events.filter(([event]) => event === "video").length, 0);
  assert.equal(result.artifact.format, "pvo");
  assert.equal(result.artifact.contentType, "application/vnd.pvo");
  assert.equal(result.artifact.blob, fixture.output);
});

test("flat export ignores inaccessible media in a branch it does not export", async () => {
  const input = project();
  input.scenes.push({ ...input.scenes[0], id: "branch", clips: [{ ...input.scenes[0].clips[0], url: "blob:unavailable-branch" }] });
  const read = [];
  const fixture = adapters({ readMedia: async url => { read.push(url); if (url.includes("branch")) throw new Error("Missing branch"); return new Blob(["clip"]); } });
  await renderCompletedExport(captureExportSnapshot(input, "main-only"), "video", () => {}, fixture.value);
  assert.deepEqual(read, ["blob:original"]);
});

test("every acquired lease is released when another source fails", async () => {
  const input = project();
  input.scenes[0].clips.push({ ...input.scenes[0].clips[0], id: 2, url: "blob:missing" });
  const fixture = adapters({ readMedia: async url => { if (url.endsWith("missing")) throw new Error("missing clip"); return new Blob(["clip"]); } });
  await assert.rejects(renderCompletedExport(captureExportSnapshot(input, "failure"), "video", () => {}, fixture.value), /missing clip/);
  assert.deepEqual(fixture.events, [["revoke", "blob:leased"]]);
});

test("a rendering failure releases leased sources without creating an artifact", async () => {
  const fixture = adapters({ video: async () => { throw new Error("encoder failed"); } });
  await assert.rejects(renderCompletedExport(captureExportSnapshot(project(), "failure"), "video", () => {}, fixture.value), /encoder failed/);
  assert.deepEqual(fixture.events.at(-1), ["revoke", "blob:leased"]);
});

test("replacement and reset revoke URLs while an upload can retain the immutable Blob", t => {
  const prior = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = url => revoked.push(url);
  t.after(() => { resetExportArtifact(); URL.revokeObjectURL = prior; });
  resetExportArtifact();
  const artifact = { snapshotId: "one", blob: new Blob(["saved"]), filename: "video.webm", contentType: "video/webm", format: "video", createdAt: "now" };
  beginExportAttempt("one");
  assert.equal(finishExportAttempt(artifact, "blob:one"), true);
  const uploadOwned = useExportArtifact.getState().artifact.blob;
  beginPublicationAttempt("one", "Original title");
  setExportPublication("one", { id: "pub-one", url: "https://app.example/player/pub-one", status: "pending" });
  resetExportArtifact();
  assert.equal(useExportArtifact.getState().artifact, null);
  assert.equal(uploadOwned.size, 5, "URL release cannot invalidate the Blob captured by an upload");
  assert.equal(finishExportAttempt({ ...artifact, snapshotId: "stale" }, "blob:stale"), false);
  assert.deepEqual(revoked, ["blob:one", "blob:stale"]);
});

test("publishing validates authentication and size without changing the completed artifact", () => {
  const artifact = { snapshotId: "one", blob: new Blob(["file"]), filename: "video.webm", contentType: "video/webm", format: "video", createdAt: "now" };
  const status = { available: true, authenticated: true, maxBytes: 10 };
  assert.deepEqual(publicationInput(artifact, "  My video  ", status, "same-key"), {
    title: "My video", filename: "video.webm", contentType: "video/webm", format: "video", size: 4, idempotencyKey: "same-key",
  });
  assert.throws(() => publicationInput(artifact, "Title", { ...status, available: false }, "key"), /isn’t available/);
  assert.throws(() => publicationInput(artifact, "Title", { ...status, authenticated: false }, "key"), /Sign in/);
  assert.throws(() => publicationInput(artifact, "Title", { ...status, maxBytes: 3 }, "key"), /size limit/);
  assert.throws(() => publicationInput(artifact, " ", status, "key"), /title/);
});

test("confirmed deletion forgets readiness before a response and cannot be undone by a late upload", t => {
  t.after(resetExportArtifact);
  resetExportArtifact();
  const artifact = { snapshotId: "deleting", blob: new Blob(["keep this export"]), filename: "video.webm", contentType: "video/webm", format: "video", createdAt: "now" };
  beginExportAttempt(artifact.snapshotId);
  finishExportAttempt(artifact, "blob:deleting");
  const ready = { id: "deleted-link", url: "https://app.example/player/deleted-link", status: "ready" };
  beginPublicationAttempt(artifact.snapshotId, "Old title");
  setExportPublication(artifact.snapshotId, ready, "deleting");
  forgetExportPublication(ready.id, "new-attempt-key");
  const afterConfirmation = useExportArtifact.getState();
  assert.equal(afterConfirmation.publication, null);
  assert.equal(afterConfirmation.publicationTitle, null);
  assert.equal(afterConfirmation.publicationKey, "new-attempt-key");
  assert.equal(afterConfirmation.artifact.blob, artifact.blob);
  assert.equal(afterConfirmation.url, "blob:deleting");
  setExportPublication(artifact.snapshotId, ready, "deleting");
  assert.equal(useExportArtifact.getState().publication, null, "An old upload response cannot restore the deleted link");
});
