import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ORIGIN, SECRET, tinyMp4, workerFixture } from "./publishing-server.helpers.mjs";
import { renderRoute } from "../server/render-jobs/routes.js";
import { processRenderQueue } from "../server/render-jobs/queue.js";
import { configuration } from "../server/config.js";
import { cleanupRenders } from "../server/render-jobs/cleanup.js";
import { renderInput } from "../server/render-jobs/input.js";

if (!globalThis.FixedLengthStream) {
  globalThis.FixedLengthStream = class extends TransformStream {
    constructor(length) {
      let received = 0;
      super({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > length) throw new Error("Too many bytes");
          controller.enqueue(chunk);
        },
        flush() { if (received !== length) throw new Error("Missing bytes"); },
      });
    }
  };
}

function source() {
  return { ratio: "9:16", quality: "1080p", muted: false, sound: 0,
    texts: [], components: [], audioClips: [], clips: [{ id: 1, url: "asset_0", color: "#ff758f",
      srcDur: 2, in: 0, out: 2, speed: 1, zoom: 1, mirror: false,
      width: 1080, height: 1920, fit: "contain" }] };
}

function fakeBucket() {
  const objects = new Map();
  return { objects,
    async put(key, stream, options) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      if (options?.onlyIf && objects.has(key)) return null;
      objects.set(key, new Blob([bytes], { type: options?.httpMetadata?.contentType }));
      return { size: bytes.length };
    },
    async head(key) { const blob = objects.get(key); return blob ? { size: blob.size } : null; },
    async get(key, options) {
      const original = objects.get(key);
      if (!original) return null;
      const blob = options?.range ? original.slice(options.range.offset,
        options.range.offset + options.range.length) : original;
      return { size: blob.size, body: blob.stream(), arrayBuffer: () => blob.arrayBuffer() };
    },
    async delete(key) { objects.delete(key); },
  };
}

async function renderFixture() {
  const fixture = await workerFixture();
  const migration = (await readFile("migrations/0002_render_jobs.sql", "utf8"))
    .split(";").map(statement => statement.trim()).filter(Boolean);
  await fixture.db.batch(migration.map(statement => fixture.db.prepare(statement)));
  const bucket = fakeBucket();
  const messages = [];
  const config = { origin: ORIGIN, renderAvailable: true };
  const env = { DB: fixture.db, MEDIA: bucket, SESSION_SECRET: SECRET, PUBLIC_ORIGIN: ORIGIN,
    RENDERING_ENABLED: "true",
    RENDER_QUEUE: { send: async message => { messages.push(message); } } };
  function request(path, { method = "GET", body, headers = {}, cookie = fixture.cookie } = {}) {
    const actual = path.startsWith("http") ? path : `${ORIGIN}${path}`;
    return renderRoute(new Request(actual, { method, body,
      headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...headers } }), env, config);
  }
  return { ...fixture, env, bucket, messages, request };
}

test("render capability stays unavailable until all paid renderer bindings are callable", () => {
  const env = { PUBLISHING_ENABLED: "true", RENDERING_ENABLED: "true", DB: {}, MEDIA: {},
    PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: SECRET };
  assert.equal(configuration(env, ORIGIN).renderAvailable, false);
  env.RENDER_QUEUE = { send() {} };
  env.RENDERER = { get() {}, idFromName() {} };
  assert.equal(configuration(env, ORIGIN).renderAvailable, true);
  assert.equal(configuration(env, "https://different.example").renderAvailable, false);
});

test("render jobs accept 4K source settings before any upload", () => {
  const clip = tinyMp4();
  const input = renderInput({ source: { ...source(), quality: "4K" },
    assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] });
  assert.equal(input.source.quality, "4K");
  assert.throws(() => renderInput({ source: { ...source(), quality: "8K" },
    assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] }), /cannot be rendered/i);
});

test("Worker rejects unsupported gains and animation before sanitizing the render source", () => {
  const clip = tinyMp4();
  const assets = [{ id: "asset_0", bytes: clip.size, contentType: clip.type }];
  const animated = { tracks: { gain: [{ time: 0, value: .5, easing: "linear" }] } };
  for (const scene of [
    { ...source(), clipGain: .5 },
    { ...source(), musicAnimation: animated },
    { ...source(), clips: [{ ...source().clips[0], animation: animated }] },
    { ...source(), audioClips: [{ ...source().clips[0], start: 0, muted: false, gain: .5 }] },
  ]) assert.throws(() => renderInput({ source: scene, assets }), /browser export/i);
});

test("the existing publishing cron works before the render D1 migration is applied", async () => {
  await cleanupRenders({ DB: { prepare() { throw new Error("render tables do not exist"); } },
    MEDIA: {}, RENDERING_ENABLED: "false" });
  const f = await workerFixture();
  try {
    const capability = await f.request("/api/renders");
    assert.equal(capability.status, 200);
    const options = await capability.json();
    assert.equal(options.available, false);
    assert.deepEqual(options.qualities, ["720p", "1080p", "4K"]);
    const create = await f.request("/api/renders", { method: "POST", body: "{}",
      headers: { "Content-Type": "application/json" } });
    assert.equal(create.status, 503);
  } finally { await f.close(); }
});

test("render jobs keep original sources private, return MP4, and clean on cancel", async () => {
  const f = await renderFixture();
  try {
    const clip = tinyMp4();
    const created = await f.request("/api/renders", { method: "POST",
      body: JSON.stringify({ source: source(), assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] }),
      headers: { "Content-Type": "application/json" } });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    await assert.rejects(f.request(`/api/renders/${id}`, { cookie: f.otherCookie }), /unavailable/i);
    const uploaded = await f.request(`/api/renders/${id}/sources/asset_0`, { method: "PUT", body: clip,
      headers: { "Content-Type": clip.type } });
    assert.equal(uploaded.status, 200);
    const started = await f.request(`/api/renders/${id}/start`, { method: "POST" });
    assert.equal(started.status, 202);
    assert.deepEqual(f.messages, [{ id }]);
    f.env.RENDERER = { idFromName: name => name, get: () => ({ fetch: async (_url, options) => {
      const job = JSON.parse(options.body);
      assert.equal(job.source.clips[0].url, "asset_0");
      const sourceResponse = await f.request(job.assets[0].url, { cookie: null });
      assert.equal(sourceResponse.status, 200);
      assert.equal((await sourceResponse.arrayBuffer()).byteLength, clip.size);
      const progress = await f.request(job.progressUrl, { method: "POST", cookie: null,
        body: JSON.stringify({ fraction: .5 }), headers: { "Content-Type": "application/json" } });
      assert.equal(progress.status, 200);
      assert.equal((await (await f.request(`/api/renders/${id}`)).json()).progress, .5);
      await assert.rejects(f.request(job.assets[0].url.replace("token=", "token=x"), { cookie: null }),
        /unavailable|expired/i);
      const output = await f.request(job.outputUrl, { method: "PUT", body: clip, cookie: null,
        headers: { "Content-Type": "video/mp4", "Content-Length": String(clip.size) } });
      assert.equal(output.status, 200);
      return Response.json({ duration: 2, bytes: clip.size, contentType: "video/mp4" });
    } }) };
    await processRenderQueue({ messages: [{ body: { id } }] }, f.env);
    const status = await (await f.request(`/api/renders/${id}`)).json();
    assert.equal(status.status, "ready");
    assert.equal(status.progress, 1);
    assert.equal(status.resultUrl, `/api/renders/${id}/result`);
    const result = await f.request(status.resultUrl);
    assert.equal(result.headers.get("Content-Type"), "video/mp4");
    assert.equal((await result.arrayBuffer()).byteLength, clip.size);
    assert.equal((await f.request(`/api/renders/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(f.bucket.objects.size, 0);
  } finally { await f.close(); }
});

test("unsupported effects fail before a render job or upload is created", async () => {
  const f = await renderFixture();
  try {
    const clip = tinyMp4();
    const edited = source();
    edited.texts = [{ id: 2, text: "Hello", start: 0, end: 1 }];
    edited.layers = ["video", "text:2"];
    await assert.rejects(f.request("/api/renders", { method: "POST",
      body: JSON.stringify({ source: edited, assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] }),
      headers: { "Content-Type": "application/json" } }), /browser export/i);
    const count = await f.db.prepare("SELECT COUNT(*) AS count FROM render_jobs").first();
    assert.equal(count.count, 0);
  } finally { await f.close(); }
});

test("hidden text and component timing extend a scene without persisting authored content", async () => {
  const f = await renderFixture();
  try {
    const clip = tinyMp4();
    const edited = source();
    edited.texts = [{ id: 2, text: "private caption", start: 0, end: 3 }];
    edited.components = [{ id: "component_1", at: 3, dur: 1,
      fields: { body: "private form copy" }, code: { pvo: "private code" } }];
    edited.layers = ["text:2", "video", "component:component_1"];
    const created = await f.request("/api/renders", { method: "POST",
      body: JSON.stringify({ source: edited, assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] }),
      headers: { "Content-Type": "application/json" } });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const row = await f.db.prepare("SELECT source_json FROM render_jobs WHERE id = ?").bind(id).first();
    assert.ok(!row.source_json.includes("private"));
    const stored = JSON.parse(row.source_json);
    assert.deepEqual(stored.texts, [{ id: 2, start: 0, end: 3 }]);
    assert.deepEqual(stored.components, [{ id: "component_1", at: 3, dur: 1 }]);
    assert.deepEqual(stored.layers, edited.layers);
  } finally { await f.close(); }
});

test("cancelling a running render revokes its signed result upload", async () => {
  const f = await renderFixture();
  try {
    const clip = tinyMp4();
    const created = await f.request("/api/renders", { method: "POST",
      body: JSON.stringify({ source: source(), assets: [{ id: "asset_0", bytes: clip.size, contentType: clip.type }] }),
      headers: { "Content-Type": "application/json" } });
    const { id } = await created.json();
    await f.request(`/api/renders/${id}/sources/asset_0`, { method: "PUT", body: clip,
      headers: { "Content-Type": clip.type } });
    await f.request(`/api/renders/${id}/start`, { method: "POST" });
    f.env.RENDERER = { idFromName: name => name, get: () => ({ fetch: async (_url, options) => {
      const job = JSON.parse(options.body);
      await f.request(`/api/renders/${id}`, { method: "DELETE" });
      await assert.rejects(f.request(job.outputUrl, { method: "PUT", body: clip, cookie: null,
        headers: { "Content-Type": "video/mp4", "Content-Length": String(clip.size) } }), /unavailable/i);
      return Response.json({ code: "CANCELLED" }, { status: 409 });
    } }) };
    await processRenderQueue({ messages: [{ body: { id } }] }, f.env);
    assert.equal((await (await f.request(`/api/renders/${id}`)).json()).status, "cancelled");
    assert.equal(f.bucket.objects.size, 0);
  } finally { await f.close(); }
});
