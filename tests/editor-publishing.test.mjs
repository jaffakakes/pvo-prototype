import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { contents: `
  export { createPublishingClient, PublishingHttpError } from "./editor/src/infrastructure/publishing/client.ts";
  export { canShareExport, shareExportFile, cancelledShare } from "./editor/src/infrastructure/publishing/nativeShare.ts";
  export { signInWithPopup } from "./editor/src/infrastructure/publishing/signIn.ts";
  export { publicationReservation, publishingStatus } from "./editor/src/domain/publishing/responses.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { createPublishingClient, PublishingHttpError, canShareExport, shareExportFile, cancelledShare, signInWithPopup,
  publicationReservation, publishingStatus } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const origin = "https://restyle.example";
const reservation = { id: "publication_123", url: `${origin}/player/publication_123`, status: "pending" };
const artifact = () => ({ snapshotId: "snapshot-one", blob: new Blob(["exact completed export"], { type: "video/webm" }), filename: "my-video.webm", format: "video", contentType: "video/webm", createdAt: "2026-09-27T12:00:00Z" });

test("a static deployment honestly disables links without making local sharing depend on a backend", async () => {
  for (const response of [new Response("Not found", { status: 404 }), new Response("<html>App</html>", { headers: { "Content-Type": "text/html" } })]) {
    const client = createPublishingClient({ origin, fetch: async () => response });
    assert.equal((await client.status()).available, false);
  }
});

test("reservation and retry send stable metadata while upload sends the completed Blob itself", async () => {
  const calls = [];
  const client = createPublishingClient({ origin, fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ...reservation, status: options.method === "PUT" ? "ready" : "pending" });
  } });
  const file = artifact();
  const input = { title: "My video", filename: file.filename, format: file.format, contentType: file.contentType, size: file.blob.size, idempotencyKey: file.snapshotId };
  await client.reserve(input);
  await client.reserve(input);
  const ready = await client.upload(reservation.id, file);
  assert.equal(ready.status, "ready");
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(calls[2].options.body, file.blob);
  assert.equal(calls[2].url, `${origin}/api/publications/publication_123/content`);
  assert.equal(calls[2].options.credentials, "same-origin");
  assert.equal(calls[2].options.redirect, "error");
  assert.equal(calls[2].options.headers["Content-Type"], "video/webm");
});

test("publishing URLs reject external origins, blob URLs and mismatched identifiers", () => {
  assert.throws(() => publicationReservation({ ...reservation, url: "https://evil.example/player/publication_123" }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: "blob:https://restyle.example/local" }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123?src=other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123#other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, id: "../escape" }, origin), /identifier/);
  assert.throws(() => publishingStatus({ available: true, authenticated: false, maxBytes: 50, authUrl: "https://evil.example/login" }, origin), /destination/);
});

test("failed upload never returns a public ready result and uses a short operation error", async () => {
  const client = createPublishingClient({ origin, fetch: async () => new Response("internal stack trace", { status: 500 }) });
  await assert.rejects(client.upload(reservation.id, artifact()), { message: "Link sharing failed. Try again." });
});

test("expired sessions retain HTTP 401 for reservation and upload recovery", async () => {
  const client = createPublishingClient({ origin, fetch: async () => Response.json({ error: "expired" }, { status: 401 }) });
  const file = artifact();
  const input = { title: "My video", filename: file.filename, format: file.format,
    contentType: file.contentType, size: file.blob.size, idempotencyKey: file.snapshotId };
  for (const attempt of [() => client.reserve(input), () => client.upload(reservation.id, file)]) {
    await assert.rejects(attempt(), error => error instanceof PublishingHttpError
      && error.status === 401 && error.message === "Sign in to create a link.");
  }
});

test("an upload response cannot substitute another publication's link", async () => {
  const client = createPublishingClient({ origin, fetch: async () => Response.json({ id: "other", url: `${origin}/player/other`, status: "ready" }) });
  await assert.rejects(client.upload(reservation.id, artifact()), /different publication/);
});

test("timeout aborts a stuck upload; cancellation settles transports that ignore abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let transport;
  const client = createPublishingClient({ origin, timeoutMs: 20, fetch: async (_url, options) => {
    transport = options.signal; return new Promise(() => {});
  } });
  const timed = client.upload(reservation.id, artifact());
  t.mock.timers.tick(20);
  await assert.rejects(timed, /timed out/);
  assert.equal(transport.aborted, true);
  const controller = new AbortController();
  const cancelled = client.upload(reservation.id, artifact(), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(transport.aborted, true);
});

test("native file sharing checks the exact format and sends only the completed file", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let shared;
  const navigator = { canShare: data => data.files[0].type === "video/webm", share: async data => { shared = data; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator; });
  const file = artifact();
  assert.equal(canShareExport(file), true);
  assert.equal(canShareExport({ ...file, filename: "video.pvo", contentType: "application/vnd.pvo", format: "pvo" }), false);
  await shareExportFile(file);
  assert.equal(shared.files[0].name, "my-video.webm");
  assert.equal(await shared.files[0].text(), await file.blob.text());
  assert.equal("url" in shared, false);
  navigator.share = async () => { throw new DOMException("Dismissed", "AbortError"); };
  await assert.rejects(shareExportFile(file), error => cancelledShare(error));
});

test("popup sign-in only accepts the matching window on the application origin and removes listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const listeners = new Map();
  const popup = { closed: false, close() { this.closed = true; } };
  globalThis.location = { origin };
  globalThis.window = { open: () => popup, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  t.after(() => { globalThis.window = previousWindow; globalThis.location = previousLocation; });
  const controller = new AbortController();
  const pending = signInWithPopup(`${origin}/api/auth/start`, controller.signal);
  listeners.get("message")({ origin: "https://evil.example", source: popup, data: { type: "restyle-auth", ok: true } });
  assert.equal(popup.closed, false);
  listeners.get("message")({ origin, source: {}, data: { type: "restyle-auth", ok: true } });
  assert.equal(popup.closed, false);
  listeners.get("message")({ origin, source: popup, data: { type: "restyle-auth", ok: true } });
  await pending;
  assert.equal(popup.closed, true);
  assert.equal(listeners.size, 0);
});

test("closing or cancelling sign-in releases the popup without changing the opener", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const listeners = new Map();
  const popup = { closed: false, close() { this.closed = true; } };
  globalThis.location = { origin, href: `${origin}/editor/` };
  globalThis.window = { open: () => popup, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  t.after(() => { globalThis.window = previousWindow; globalThis.location = previousLocation; });
  const controller = new AbortController();
  const pending = signInWithPopup(`${origin}/api/auth/start`, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(popup.closed, true);
  assert.equal(globalThis.location.href, `${origin}/editor/`);
  assert.equal(listeners.size, 0);
});
