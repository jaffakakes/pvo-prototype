import test from "node:test";
import assert from "node:assert/strict";
import { workerFixture, ORIGIN, reserve, upload, tinyMp4, tinyWebm, tinyPvo } from "./publishing-server.helpers.mjs";
import { cleanupPublications } from "../server/publishing/cleanup.js";

test("publishing is explicitly disabled until its storage and session secret are configured", async () => {
  const f = await workerFixture({ PUBLISHING_ENABLED: "false" }, { createSessions: false });
  try {
    const status = await (await f.request("/api/publishing")).json();
    assert.deepEqual(status, { available: false, hasSession: false, maxBytes: 52428800 });
    assert.equal((await f.request("/api/publishing/session", { method: "POST" })).status, 404);
    assert.equal((await reserve(f, tinyMp4())).response.status, 503);
    assert.equal((await f.request("/docs/")).status, 404);
    assert.equal((await f.request("/demo/")).status, 404);
    assert.equal((await f.request("/api/missing")).status, 404);
    assert.equal((await f.request("/media/missing")).status, 404);
    assert.equal((await f.request("/player/published")).status, 404);
    assert.equal((await f.request("/about.html", { session: null })).status, 200);
    assert.equal((await f.request("/privacy.html", { session: null })).status, 200);
    assert.equal((await f.request("/", { redirect: "manual" })).headers.get("Location"), `${ORIGIN}/editor/?home=1`);
  } finally { await f.close(); }
});

test("account sessions, CSRF and ownership protect publication operations", async () => {
  const f = await workerFixture();
  try {
    assert.deepEqual(await (await f.request("/api/publishing")).json(),
      { available: true, hasSession: true, maxBytes: 52428800 });
    assert.equal((await reserve(f, tinyMp4(), {}, { session: null })).response.status, 401);
    assert.equal((await reserve(f, tinyMp4(), {}, { headers: { Origin: "https://attacker.example", "Content-Type": "application/json" } })).response.status, 403);
    const created = await reserve(f, tinyMp4());
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal((await f.request(`/api/publications/${id}/content`, {
      method: "PUT", session: f.otherCookie,
    })).status, 404);
    assert.equal((await f.request(`/api/publications/${id}`, { method: "DELETE", session: f.otherCookie })).status, 404);
    assert.equal((await f.request(`/player/${id}`, { session: null })).status, 404);
    assert.equal((await f.request(`/media/${id}`, { session: null })).status, 404);
  } finally { await f.close(); }
});

test("publish, retry, range-read and delete a native video without replacing its bytes", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const first = await reserve(f, file, { title: '<script>alert("title")</script>' });
    const retry = await reserve(f, file, first.input);
    assert.equal(retry.body.id, first.body.id);
    const conflict = await reserve(f, file, { ...first.input, title: "Different export" });
    assert.equal(conflict.response.status, 409);
    const id = first.body.id;
    const finished = await upload(f, id, file);
    assert.equal(finished.status, 200, await finished.clone().text());
    assert.equal((await finished.json()).status, "ready");
    const original = await f.db.prepare("SELECT object_key FROM publications WHERE id = ?").bind(id).first();
    assert.equal((await upload(f, id, new Blob(["new bytes"], { type: file.type }))).status, 200);
    assert.equal((await f.db.prepare("SELECT object_key FROM publications WHERE id = ?").bind(id).first()).object_key, original.object_key);
    const media = await f.request(`/media/${id}`, { session: null });
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("Content-Type"), "video/mp4");
    assert.deepEqual(new Uint8Array(await media.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
    const range = await f.request(`/media/${id}`, { headers: { Range: "bytes=5-12" }, session: null });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("Content-Range"), `bytes 5-12/${file.size}`);
    assert.equal((await range.arrayBuffer()).byteLength, 8);
    assert.equal((await f.request(`/media/${id}`, { headers: { Range: "bytes=9999-" } })).status, 416);
    const page = await (await f.request(`/player/${id}`, { session: null })).text();
    assert(page.includes("&lt;script&gt;"));
    assert(!page.includes('<script>alert("title")</script>'));
    assert(page.includes(`data-publication-src="${ORIGIN}/media/${id}"`));
    const listed = await (await f.request("/api/publications")).json();
    assert.equal(listed.publications[0].id, id);
    assert.equal(new Date(listed.publications[0].createdAt).toISOString(), listed.publications[0].createdAt);
    assert.equal((await (await f.request("/api/publications", { session: f.otherCookie })).json()).publications.length, 0);
    assert.equal((await f.request(`/api/publications/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await f.request(`/media/${id}`, { session: null })).status, 404);
    assert.equal((await f.request(`/player/${id}`, { session: null })).status, 404);
    assert.equal(await f.bucket.head(original.object_key), null);
  } finally { await f.close(); }
});

test("the chosen cover is owner-uploaded once, shown on the shared page, and deleted with the link", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const { body } = await reserve(f, file);
    const id = body.id;
    const poster = new Blob([new TextEncoder().encode("RIFF\x04\0\0\0WEBP")], { type: "image/webp" });
    const put = (blob, options = {}) => f.request(`/api/publications/${id}/poster`, {
      method: "PUT", body: blob, headers: { "Content-Type": blob.type }, ...options,
    });
    assert.equal((await put(poster)).status, 409, "a cover cannot publish before its video");
    assert.equal((await upload(f, id, file)).status, 200);
    assert.equal((await put(poster, { session: f.otherCookie })).status, 404);
    assert.equal((await put(new Blob(["not an image"], { type: "image/webp" }))).status, 415);
    assert.equal((await put(poster)).status, 200);
    assert.equal((await put(poster)).status, 200, "retries keep the first cover");
    const image = await f.request(`/poster/${id}`, { session: null });
    assert.equal(image.headers.get("Content-Type"), "image/webp");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array(await poster.arrayBuffer()));
    const page = await (await f.request(`/player/${id}`, { session: null })).text();
    assert(page.includes(`<meta property="og:image" content="${ORIGIN}/poster/${id}" />`));
    assert(page.includes(`data-publication-poster="${ORIGIN}/poster/${id}"`));
    assert.equal((await f.request(`/api/publications/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await f.request(`/poster/${id}`, { session: null })).status, 404);
    assert.equal(await f.bucket.head(`posters/${id}`), null);
  } finally { await f.close(); }
});

test("invalid content and changed sizes cannot become ready; successful retry uses a new attempt", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const { body } = await reserve(f, file);
    const invalid = new Blob([new Uint8Array(file.size)], { type: file.type });
    assert.equal((await upload(f, body.id, invalid)).status, 415);
    assert.equal((await f.bucket.list()).objects.length, 0);
    const short = new Blob([new Uint8Array(file.size - 1)], { type: file.type });
    assert.equal((await upload(f, body.id, short)).status, 400);
    const shortStream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(file.size - 1));
      controller.close();
    } });
    assert.equal((await f.request(`/api/publications/${body.id}/content`, { method: "PUT", body: shortStream,
      headers: { "Content-Type": file.type }, duplex: "half" })).status, 400);
    assert.equal((await f.bucket.list()).objects.length, 0);
    assert.equal((await f.request(`/media/${body.id}`)).status, 404);
    assert.equal((await upload(f, body.id, file)).status, 200);
    assert.equal((await f.bucket.list()).objects.length, 1);
  } finally { await f.close(); }
});

test("WebM and interactive PVO exports retain their verified formats", async () => {
  const f = await workerFixture();
  try {
    for (const file of [tinyWebm(), await tinyPvo()]) {
      const { body } = await reserve(f, file);
      const done = await upload(f, body.id, file);
      assert.equal(done.status, 200, await done.clone().text());
      const media = await f.request(`/media/${body.id}`, { session: null });
      assert.equal(media.headers.get("Content-Type"), file.type);
      assert.deepEqual(new Uint8Array(await media.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
    }
  } finally { await f.close(); }
});

test("published PVO poster bytes must decode as a WebP signature", async () => {
  const f = await workerFixture();
  try {
    const goodPoster = new Blob([new TextEncoder().encode("RIFF\x04\0\0\0WEBP")], { type: "image/webp" });
    const good = await tinyPvo(goodPoster);
    const goodReservation = await reserve(f, good);
    assert.equal((await upload(f, goodReservation.body.id, good)).status, 200);
    const bad = await tinyPvo(new Blob(["wrong image"], { type: "image/webp" }));
    const badReservation = await reserve(f, bad);
    assert.equal((await upload(f, badReservation.body.id, bad)).status, 415);
  } finally { await f.close(); }
});

test("PNG covers keep their content type through upload and published PVO validation", async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: "image/png" });
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const { body } = await reserve(f, file);
    assert.equal((await upload(f, body.id, file)).status, 200);
    const put = blob => f.request(`/api/publications/${body.id}/poster`, {
      method: "PUT", body: blob, headers: { "Content-Type": blob.type },
    });
    assert.equal((await put(new Blob(["bad PNG"], { type: "image/png" }))).status, 415);
    assert.equal((await put(png)).status, 200);
    const served = await f.request(`/poster/${body.id}`, { session: null });
    assert.equal(served.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(await png.arrayBuffer()));
    const pvo = await tinyPvo(png);
    const reservation = await reserve(f, pvo);
    assert.equal((await upload(f, reservation.body.id, pvo)).status, 200);
  } finally { await f.close(); }
});

test("quota reservations are atomic across concurrent requests and reclaimed after expiry", async () => {
  const file = tinyMp4();
  const f = await workerFixture({ OWNER_STORAGE_BYTES: String(file.size), TOTAL_STORAGE_BYTES: String(file.size) });
  try {
    const results = await Promise.all([reserve(f, file), reserve(f, file)]);
    assert.deepEqual(results.map(result => result.response.status).sort(), [201, 429]);
    assert.equal((await reserve(f, file, {}, { session: f.otherCookie })).response.status, 429);
    const id = results.find(result => result.response.status === 201).body.id;
    await f.db.prepare("UPDATE publications SET expires_at = 1 WHERE id = ?").bind(id).run();
    await cleanupPublications({ DB: f.db, MEDIA: f.bucket });
    assert.equal((await reserve(f, file)).response.status, 201);
    assert.equal((await reserve(f, file, { size: 52428801 })).response.status, 413);
  } finally { await f.close(); }
});

test("cleanup retains ready objects and removes expired upload attempts", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const ready = await reserve(f, file);
    await upload(f, ready.body.id, file);
    const pending = await reserve(f, file);
    const key = `exports/${pending.body.id}/abandoned`;
    await f.bucket.put(key, file);
    await f.db.batch([
      f.db.prepare("UPDATE publications SET active_attempt = 'abandoned' WHERE id = ?").bind(pending.body.id),
      f.db.prepare("INSERT INTO upload_attempts (id, publication_id, object_key, created_at, expires_at) VALUES ('abandoned', ?, ?, 1, 2)")
        .bind(pending.body.id, key),
    ]);
    await cleanupPublications({ DB: f.db, MEDIA: f.bucket });
    assert.equal(await f.bucket.head(key), null);
    assert.equal((await f.bucket.list()).objects.length, 1);
    assert.equal((await f.request(`/media/${ready.body.id}`)).status, 200);
    assert.equal((await upload(f, pending.body.id, file)).status, 200);
  } finally { await f.close(); }
});
