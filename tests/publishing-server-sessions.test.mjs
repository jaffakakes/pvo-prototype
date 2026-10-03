import test from "node:test";
import assert from "node:assert/strict";
import { configuration } from "../server/config.js";
import { digest } from "../server/identity.js";
import { signCookie, verifyCookie } from "../server/publishing/sessionCookies.js";
import { workerFixture, ORIGIN, SECRET, reserve, upload, tinyMp4 } from "./publishing-server.helpers.mjs";

const cookieName = "__Host-restyle-publishing";
const expectedStatus = hasSession => ({ available: true, hasSession, maxBytes: 52428800 });

async function counts(db) {
  return {
    creators: (await db.prepare("SELECT COUNT(*) AS count FROM creators").first()).count,
    sessions: (await db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count,
  };
}

test("publishing availability requires storage, a strong session secret and its exact HTTPS origin", () => {
  const env = { PUBLISHING_ENABLED: "true", PUBLIC_ORIGIN: ORIGIN, DB: {}, MEDIA: {}, SESSION_SECRET: SECRET };
  assert.equal(configuration(env, ORIGIN).available, true);
  for (const changes of [
    { PUBLISHING_ENABLED: "false" }, { DB: null }, { MEDIA: null }, { SESSION_SECRET: "short" },
    { PUBLIC_ORIGIN: "http://restyle.example" }, { PUBLIC_ORIGIN: `${ORIGIN}/path` },
  ]) assert.equal(configuration({ ...env, ...changes }, ORIGIN).available, false);
  assert.equal(configuration(env, "https://other.example").available, false);
});

test("status is read-only and an explicit same-origin action creates one reusable browser session", async () => {
  const f = await workerFixture({}, { createSessions: false });
  try {
    const status = await f.request("/api/publishing");
    assert.deepEqual(await status.json(), expectedStatus(false));
    assert.equal(status.headers.get("Set-Cookie"), null);
    assert.deepEqual(await counts(f.db), { creators: 0, sessions: 0 });

    const created = await f.request("/api/publishing/session", { method: "POST" });
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), expectedStatus(true));
    const cookieHeader = created.headers.get("Set-Cookie");
    assert(cookieHeader.startsWith(`${cookieName}=`));
    assert(cookieHeader.endsWith("; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax"));
    const cookie = cookieHeader.split(";", 1)[0];
    const credential = cookie.slice(cookie.indexOf("=") + 1);
    const payload = await verifyCookie(credential, SECRET);
    assert.match(payload.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(payload.exp - payload.iat, 180 * 24 * 60 * 60);
    const owner = await f.db.prepare("SELECT * FROM creators").first();
    assert.deepEqual(Object.keys(owner).sort(), ["created_at", "id"]);
    const stored = await f.db.prepare("SELECT * FROM sessions").first();
    assert.equal(stored.token_hash, await digest(payload.token));
    assert.notEqual(stored.token_hash, payload.token);
    assert.equal(stored.owner_id, owner.id);
    assert(Math.abs(stored.expires_at - (Date.now() + 15552000000)) < 10000);

    const reused = await f.request("/api/publishing/session", { method: "POST", session: cookie });
    assert.deepEqual(await reused.json(), expectedStatus(true));
    assert.equal(reused.headers.get("Set-Cookie"), null);
    assert.deepEqual(await counts(f.db), { creators: 1, sessions: 1 });
    assert.deepEqual(await (await f.request("/api/publishing", { session: cookie })).json(), expectedStatus(true));
  } finally { await f.close(); }
});

test("session creation rejects cross-site requests and removed sign-in routes remain unavailable", async () => {
  const f = await workerFixture({}, { createSessions: false });
  try {
    for (const headers of [
      { Origin: "https://attacker.example" }, { Origin: "null" }, { Origin: "" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      const response = await f.request("/api/publishing/session", { method: "POST", headers });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Set-Cookie"), null);
    }
    assert.equal((await f.request("/api/publishing/session")).status, 405);
    for (const path of ["/api/auth/login", "/api/auth/callback?code=bad&state=bad", "/api/auth/logout"])
      assert.equal((await f.request(path, { method: path.endsWith("logout") ? "POST" : "GET" })).status, 404);
    assert.deepEqual(await counts(f.db), { creators: 0, sessions: 0 });
  } finally { await f.close(); }
});

test("forged, expired and removed browser sessions cannot manage existing links", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const published = await reserve(f, file);
    assert.equal((await upload(f, published.body.id, file)).status, 200);
    const value = f.cookie.slice(f.cookie.indexOf("=") + 1);
    const payload = await verifyCookie(value, SECRET);
    const invalidSessions = [
      `${cookieName}=${value.slice(0, -8)}tampered`,
      `${cookieName}=${await signCookie({ token: payload.token }, `${SECRET}-other`, 300)}`,
      `${cookieName}=${await signCookie({ token: payload.token }, SECRET, -1)}`,
      `${cookieName}=${await signCookie({ token: "invented-owner-token" }, SECRET, 300)}`,
    ];
    for (const session of invalidSessions) {
      const status = await f.request("/api/publishing", { session });
      assert.deepEqual(await status.json(), expectedStatus(false));
      assert.equal(status.headers.get("Set-Cookie"), null);
      assert.equal((await f.request("/api/publications", { session })).status, 401);
      assert.equal((await f.request(`/api/publications/${published.body.id}`, { method: "DELETE", session })).status, 401);
    }
    assert.deepEqual(await counts(f.db), { creators: 2, sessions: 2 });
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE token_hash = ?").bind(await digest(payload.token)).run();
    assert.deepEqual(await (await f.request("/api/publishing")).json(), expectedStatus(false));
    assert.equal((await reserve(f, file)).response.status, 401);
    const replacement = await f.request("/api/publishing/session", { method: "POST" });
    assert.deepEqual(await replacement.json(), expectedStatus(true));
    const replacementCookie = replacement.headers.get("Set-Cookie").split(";", 1)[0];
    assert.notEqual(replacementCookie, f.cookie);
    assert.equal((await f.request(`/api/publications/${published.body.id}`, {
      method: "DELETE", session: replacementCookie,
    })).status, 404);
    assert.equal((await f.request(`/media/${published.body.id}`, { session: null })).status, 200);
    await f.db.prepare("DELETE FROM sessions").run();
    assert.deepEqual(await (await f.request("/api/publishing", { session: replacementCookie })).json(), expectedStatus(false));
  } finally { await f.close(); }
});

test("separate browsers keep independent ownership while viewers need no session", async () => {
  const f = await workerFixture();
  try {
    assert.notEqual(f.cookie, f.otherCookie);
    const file = tinyMp4();
    const first = await reserve(f, file);
    await upload(f, first.body.id, file);
    const second = await reserve(f, file, first.input, { session: f.otherCookie });
    assert.notEqual(second.body.id, first.body.id);
    await upload(f, second.body.id, file, { session: f.otherCookie });
    assert.deepEqual((await (await f.request("/api/publications")).json()).publications.map(item => item.id), [first.body.id]);
    assert.deepEqual((await (await f.request("/api/publications", { session: f.otherCookie })).json()).publications.map(item => item.id), [second.body.id]);
    assert.equal((await f.request(`/api/publications/${first.body.id}`, { method: "DELETE", session: f.otherCookie })).status, 404);
    assert.equal((await f.request(`/player/${first.body.id}`, { session: null })).status, 200);
    assert.equal((await f.request(`/media/${first.body.id}`, { session: null })).status, 200);
  } finally { await f.close(); }
});
