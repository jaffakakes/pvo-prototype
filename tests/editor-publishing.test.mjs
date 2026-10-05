import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { contents: `
  export { createPublishingClient, PublishingHttpError } from "./editor/src/infrastructure/publishing/client.ts";
  export { canShareExport, shareExportFile, cancelledShare } from "./editor/src/infrastructure/publishing/nativeShare.ts";
  export { publicationReservation, publishingStatus } from "./editor/src/domain/publishing/responses.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { createPublishingClient, PublishingHttpError, canShareExport, shareExportFile, cancelledShare,
  publicationReservation, publishingStatus } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const origin = "https://restyle.example";
const reservation = { id: "publication_123", url: `${origin}/player/publication_123`, status: "pending" };
const artifact = () => ({ snapshotId: "snapshot-one", blob: new Blob(["exact completed export"], { type: "video/webm" }), filename: "my-video.webm", format: "video", contentType: "video/webm", createdAt: "2026-09-27T12:00:00Z" });

test("a static deployment honestly disables online links", async () => {
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

test("cover upload sends only the frozen WebP Blob to the owned publication", async () => {
  const calls = [];
  const client = createPublishingClient({ origin, fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ uploaded: true });
  } });
  const poster = new Blob(["RIFF....WEBP"], { type: "image/webp" });
  await client.uploadPoster(reservation.id, poster);
  assert.equal(calls[0].url, `${origin}/api/publications/publication_123/poster`);
  assert.equal(calls[0].options.body, poster);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["Content-Type"], "image/webp");
  const png = new Blob(["png"], { type: "image/png" });
  await client.uploadPoster(reservation.id, png);
  assert.equal(calls[1].options.body, png);
  assert.equal(calls[1].options.headers["Content-Type"], "image/png");
  await assert.rejects(client.uploadPoster(reservation.id, new Blob(["wrong"], { type: "image/jpeg" })), /cover/);
});

test("publishing URLs reject external origins, blob URLs and mismatched identifiers", () => {
  assert.throws(() => publicationReservation({ ...reservation, url: "https://evil.example/player/publication_123" }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: "blob:https://restyle.example/local" }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123?src=other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, url: `${origin}/player/publication_123#other` }, origin), /destination/);
  assert.throws(() => publicationReservation({ ...reservation, id: "../escape" }, origin), /identifier/);
});

test("failed upload never returns a public ready result and uses a short operation error", async () => {
  const client = createPublishingClient({ origin, fetch: async () => new Response("internal stack trace", { status: 500 }) });
  await assert.rejects(client.upload(reservation.id, artifact()), { message: "Link sharing failed. Try again." });
});

test("signed-out publication requests retain HTTP 401 for account recovery", async () => {
  const client = createPublishingClient({ origin, fetch: async () => Response.json({ error: "expired" }, { status: 401 }) });
  const file = artifact();
  const input = { title: "My video", filename: file.filename, format: file.format,
    contentType: file.contentType, size: file.blob.size, idempotencyKey: file.snapshotId };
  for (const attempt of [() => client.reserve(input), () => client.upload(reservation.id, file)]) {
    await assert.rejects(attempt(), error => error instanceof PublishingHttpError
      && error.status === 401 && error.message === "Sign in to manage or create links.");
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

test("publishing status requires an account session flag", () => {
  assert.deepEqual(publishingStatus({ available: true, hasSession: false, maxBytes: 50 }), {
    available: true, hasSession: false, maxBytes: 50,
  });
  assert.throws(() => publishingStatus({ available: true, maxBytes: 50 }), /status/);
  assert.throws(() => publishingStatus({ available: true, hasSession: "yes", maxBytes: 50 }), /status/);
});

test("reading availability uses the existing same-origin account session", async () => {
  const calls = [];
  const client = createPublishingClient({ origin, fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ available: true, hasSession: true, maxBytes: 50 });
  } });
  assert.equal((await client.status()).hasSession, true);
  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [[`${origin}/api/publishing`, "GET"]]);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
});

test("cancelling a status refresh releases the request and allows a fresh check", async () => {
  let transport;
  let release;
  let attempts = 0;
  const status = { available: true, hasSession: true, maxBytes: 50 };
  const client = createPublishingClient({ origin, fetch: async (_url, options) => {
    attempts++;
    transport = options.signal;
    if (attempts === 1) return new Promise(resolve => { release = resolve; });
    return Response.json(status);
  } });
  const controller = new AbortController();
  const pending = client.status(controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(transport.aborted, true);
  release(Response.json(status));
  assert.deepEqual(await client.status(), status);
  assert.equal(attempts, 2);
});

test("an expired reservation retains HTTP 410 so the next explicit attempt can use a fresh identity", async () => {
  const client = createPublishingClient({ origin, fetch: async () => Response.json({ error: "gone" }, { status: 410 }) });
  const file = artifact();
  const input = { title: "My video", filename: file.filename, format: file.format,
    contentType: file.contentType, size: file.blob.size, idempotencyKey: file.snapshotId };
  await assert.rejects(client.reserve(input), error => error instanceof PublishingHttpError
    && error.status === 410 && error.message === "This link is no longer available. Try creating it again.");
});
