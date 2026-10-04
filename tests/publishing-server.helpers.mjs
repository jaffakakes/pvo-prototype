import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { packPvoProject } from "../packages/pvo-sdk/index.js";
import { createAccountSession } from "../server/auth/sessions.js";

export const ORIGIN = "https://restyle.example";
export const SECRET = "integration-test-session-secret-not-used-in-production";
let bundle;

export async function workerFixture(overrides = {}, { createSessions = true, outboundService } = {}) {
  bundle ??= bundleWorkerModules({ entryPoints: ["server/index.js"] });
  const template = await readFile("player/published.html", "utf8");
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "publishing-test",
    modules: await bundle, compatibilityDate: "2026-09-27",
    d1Databases: ["DB"], r2Buckets: ["MEDIA"],
    bindings: { PUBLISHING_ENABLED: "true", PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: SECRET, ...overrides },
    ...(outboundService ? { outboundService } : {}),
    serviceBindings: { ASSETS: request => new Response(new URL(request.url).pathname === "/player/published"
      ? template : "static asset", { headers: { "Content-Type": "text/html" } }) },
  }));
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("MEDIA");
  const migrations = (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort();
  for (const migration of migrations) {
    const statements = (await readFile(`migrations/${migration}`, "utf8"))
      .split(";").map(sql => sql.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
  }
  let cookie = null;
  let otherCookie = null;
  async function request(path, { method = "GET", body, headers = {}, session = cookie, ...rest } = {}) {
    return mf.dispatchFetch(`${ORIGIN}${path}`, { method, body,
      headers: { Origin: ORIGIN, ...(session ? { Cookie: session } : {}), ...headers }, ...rest });
  }
  if (createSessions) {
    cookie = (await createAccountSession({ sub: "fixture-google-subject-1", name: "First creator" },
      { DB: db, SESSION_SECRET: SECRET })).split(";", 1)[0];
    otherCookie = (await createAccountSession({ sub: "fixture-google-subject-2", name: "Second creator" },
      { DB: db, SESSION_SECRET: SECRET })).split(";", 1)[0];
  }
  return { mf, db, bucket, cookie, otherCookie, request, close: () => mf.dispose() };
}

function box(name, contents) {
  const result = new Uint8Array(8 + contents.length);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(new TextEncoder().encode(name), 4);
  result.set(contents, 8);
  return result;
}

export function tinyMp4() {
  return new Blob([box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom")),
    box("moov", new Uint8Array([1, 2, 3, 4])), box("mdat", new Uint8Array([1, 2, 3, 4, 5]))], { type: "video/mp4" });
}

export function tinyWebm() {
  return new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
    0x18, 0x53, 0x80, 0x67, 0xff, 0x16, 0x54, 0xae, 0x6b, 0x81, 0, 0x1f, 0x43, 0xb6, 0x75, 0x81, 0])], { type: "video/webm" });
}

export async function tinyPvo() {
  const manifest = { spec_version: "0.1-prototype", scenes: [{ id: "main", start: 0, end: 1 }], components: [],
    media: [{ id: "video", asset_id: "video", type: "video/mp4" }],
    playback: { initial_timeline: "main", timelines: [{ id: "main", clips: [{ id: "clip", asset_id: "video", scene: "main", start: 0, end: 1 }] }] } };
  return packPvoProject({ manifest, assets: [{ id: "video", blob: tinyMp4() }] });
}

export async function reserve(fixture, file, overrides = {}, options = {}) {
  const input = { title: "A published video", filename: file.type === "application/vnd.pvo" ? "video.pvo" : "video.mp4",
    format: file.type === "application/vnd.pvo" ? "pvo" : "video", contentType: file.type, size: file.size,
    idempotencyKey: crypto.randomUUID(), ...overrides };
  const response = await fixture.request("/api/publications", { method: "POST", body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" }, ...options });
  return { response, body: await response.json(), input };
}

export function upload(fixture, id, file, options = {}) {
  return fixture.request(`/api/publications/${id}/content`, { method: "PUT", body: file,
    headers: { "Content-Type": file.type }, ...options });
}
