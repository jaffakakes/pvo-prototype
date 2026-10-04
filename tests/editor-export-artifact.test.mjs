import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { contents: `
  export { captureExportSnapshot, publicationInput } from "./editor/src/domain/publishing/exportSnapshot.ts";
  export { renderCompletedExport } from "./editor/src/features/export/exportWorkflow.ts";
  export { useExportArtifact, beginExportAttempt, cancelExportAttempt, finishExportAttempt, setExportPublication, beginPublicationAttempt, expirePublicationAttempt, forgetExportPublication, resetExportArtifact } from "./editor/src/state/export/exportArtifactStore.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { captureExportSnapshot, publicationInput, renderCompletedExport, useExportArtifact,
  beginExportAttempt, cancelExportAttempt, finishExportAttempt, setExportPublication, beginPublicationAttempt, expirePublicationAttempt, forgetExportPublication, resetExportArtifact } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function project() {
  return { currentSceneId: "main", ratio: "9:16", coverAt: 1.2, quality: "720p", allowedDomains: ["example.com"], scenes: [{
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
  input.coverAt = 1.8;
  assert.equal(snapshot.scenes[0].texts[0].text, "Original");
  assert.equal(snapshot.scenes[0].clips[0].out, 2);
  assert.deepEqual(snapshot.allowedDomains, ["example.com"]);
  assert.equal(snapshot.quality, "720p");
  assert.equal(snapshot.coverAt, 1.2);
});

test("a cover beyond a shortened main scene freezes to its final visible frame", () => {
  const input = project();
  input.coverAt = 9;
  input.scenes[0].clips[0].out = 1;
  input.scenes[0].texts[0].end = 1;
  const snapshot = captureExportSnapshot(input, "shortened");
  assert(snapshot.coverAt > 0.9 && snapshot.coverAt < 1);
});

test("flat exports render once from leased snapshot inputs and preserve the returned Blob", async () => {
  const snapshot = captureExportSnapshot(project(), "snapshot-one");
  const fixture = adapters();
  const result = await renderCompletedExport(snapshot, "video", () => {}, fixture.value);
  assert.equal(result.artifact.blob, fixture.output);
  assert.equal(result.artifact.snapshotId, "snapshot-one");
  assert.equal(result.artifact.format, "video");
  assert.equal(result.artifact.contentType, "video/webm");
  assert.equal(result.artifact.coverAt, 1.2);
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

test("the cover selected at export start is frozen with the result and passed to PVO packaging", async () => {
  const fixture = adapters();
  const poster = new Blob(["RIFF....WEBP"], { type: "image/webp" });
  fixture.value.pvo = async (_source, _progress, _renderScene, suppliedPoster) => {
    assert.equal(suppliedPoster, poster);
    return { blob: fixture.output, url: "blob:completed", name: "video.pvo" };
  };
  const snapshot = captureExportSnapshot(project(), "poster-pvo");
  const result = await renderCompletedExport(snapshot, "pvo", () => {}, fixture.value, { poster });
  assert.equal(result.artifact.poster, poster);
  assert.equal(result.artifact.coverAt, 1.2);
});

test("eligible flat export gives original source bytes and selected quality to server", async () => {
  const fixture = adapters();
  const input = project();
  input.scenes[0].texts = [];
  input.scenes[0].layers = ["video"];
  const original = new Blob(["original video"], { type: "video/quicktime" });
  fixture.value.readMedia = async url => { fixture.events.push(["read", url]); return original; };
  fixture.value.server = () => async (source, media, progress) => {
    fixture.events.push(["server", source, media]);
    progress(1);
    return { blob: fixture.output, url: "blob:remote", name: "video.mp4" };
  };
  const result = await renderCompletedExport(captureExportSnapshot(input, "server-flat"), "video", () => {}, fixture.value);
  const [, source, media] = fixture.events.find(([event]) => event === "server");
  assert.equal(source.quality, "720p");
  assert.equal(media.get("blob:leased"), original);
  assert.equal(result.artifact.blob, fixture.output);
  assert.equal(result.url, "blob:remote");
  assert.equal(fixture.events.filter(([event]) => event === "video").length, 0);
});

test("PVO workflow can use the same server scene renderer before packaging", async () => {
  const fixture = adapters();
  const input = project();
  input.scenes[0].texts = [];
  input.scenes[0].layers = ["video"];
  fixture.value.server = () => async (source, media) => {
    fixture.events.push(["server-scene", source, media]);
    return { blob: new Blob(["scene mp4"], { type: "video/mp4" }), url: "blob:scene", name: "scene.mp4" };
  };
  fixture.value.pvo = async (source, progress, renderScene) => {
    const scene = source.scenes[0];
    const rendered = await renderScene({ ...scene, ratio: source.ratio, quality: source.quality }, progress);
    fixture.events.push(["package", rendered.blob.type]);
    return { blob: fixture.output, url: "blob:completed", name: "video.pvo" };
  };
  const result = await renderCompletedExport(captureExportSnapshot(input, "server-pvo"), "pvo", () => {}, fixture.value);
  assert.equal(result.artifact.format, "pvo");
  assert.equal(fixture.events.filter(([event]) => event === "server-scene").length, 1);
  assert.deepEqual(fixture.events.find(([event]) => event === "package"), ["package", "video/mp4"]);
  assert.equal(fixture.events.filter(([event]) => event === "video").length, 0);
});

test("an unavailable server falls back to the browser renderer for that scene", async () => {
  const fixture = adapters();
  fixture.value.server = () => async () => null;
  await renderCompletedExport(captureExportSnapshot(project(), "browser-fallback"), "video", () => {}, fixture.value);
  assert.equal(fixture.events.filter(([event]) => event === "video").length, 1);
});

test("browser fallback receives cancellation and releases its leased source", async () => {
  const fixture = adapters();
  const controller = new AbortController();
  fixture.value.server = () => async () => null;
  fixture.value.video = async (_source, _progress, signal) => {
    assert.equal(signal, controller.signal);
    controller.abort(new DOMException("Cancelled", "AbortError"));
    signal.throwIfAborted();
  };
  await assert.rejects(renderCompletedExport(captureExportSnapshot(project(), "browser-cancel"),
    "video", () => {}, fixture.value, { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(fixture.events.at(-1), ["revoke", "blob:leased"]);
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

test("a closing export sheet can cancel only the attempt it owns", t => {
  t.after(resetExportArtifact);
  const old = new AbortController();
  const current = new AbortController();
  beginExportAttempt("older", old);
  beginExportAttempt("current", current);
  assert.equal(cancelExportAttempt("older"), false);
  assert.equal(current.signal.aborted, false);
  assert.equal(cancelExportAttempt("current"), true);
  assert.equal(current.signal.aborted, true);
  assert.equal(useExportArtifact.getState().attempt, null);
});

test("publishing validates an account session and size without changing the completed artifact", () => {
  const artifact = { snapshotId: "one", blob: new Blob(["file"]), filename: "video.webm", contentType: "video/webm", format: "video", createdAt: "now" };
  const status = { available: true, hasSession: true, maxBytes: 10 };
  assert.deepEqual(publicationInput(artifact, "  My video  ", status, "same-key"), {
    title: "My video", filename: "video.webm", contentType: "video/webm", format: "video", size: 4, idempotencyKey: "same-key",
  });
  assert.throws(() => publicationInput(artifact, "Title", { ...status, available: false }, "key"), /isn’t available/);
  assert.throws(() => publicationInput(artifact, "Title", { ...status, hasSession: false }, "key"), /Sign in/);
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

test("expired reservations renew their attempt identity while retaining the exact export and title", t => {
  t.after(resetExportArtifact);
  for (const knownReservation of [false, true]) {
    resetExportArtifact();
    const artifact = { snapshotId: "expired", blob: new Blob(["exact bytes"]), filename: "video.webm", contentType: "video/webm", format: "video", createdAt: "now" };
    beginExportAttempt(artifact.snapshotId);
    finishExportAttempt(artifact, "blob:expired");
    beginPublicationAttempt(artifact.snapshotId, "My retained title");
    if (knownReservation)
      setExportPublication(artifact.snapshotId, { id: "gone", url: "https://app.example/player/gone", status: "pending" });
    expirePublicationAttempt(artifact.snapshotId, "expired", "new-attempt");
    const renewed = useExportArtifact.getState();
    assert.equal(renewed.publicationKey, "new-attempt", "Recovery must also work after a lost reservation response with no known ID");
    assert.equal(renewed.publication, null);
    assert.equal(renewed.publicationTitle, "My retained title");
    assert.equal(renewed.artifact, artifact);
    assert.equal(renewed.url, "blob:expired");
    setExportPublication(artifact.snapshotId, { id: "new", url: "https://app.example/player/new", status: "ready" }, "new-attempt");
    expirePublicationAttempt(artifact.snapshotId, "expired", "late-expiry");
    expirePublicationAttempt("other-snapshot", "new-attempt", "wrong-snapshot");
    assert.equal(useExportArtifact.getState().publicationKey, "new-attempt");
    assert.equal(useExportArtifact.getState().publication.id, "new", "A late expiry cannot clear a different attempt");
  }
});
