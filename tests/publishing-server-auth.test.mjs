import test from "node:test";
import assert from "node:assert/strict";
import { configuration } from "../server/config.js";
import { cleanupAccountSessions } from "../server/auth/sessions.js";
import { signCookie, verifyCookie } from "../server/auth/tokens.js";
import { workerFixture, ORIGIN, SECRET } from "./publishing-server.helpers.mjs";
import { PROJECT_URL, PUBLISHABLE_KEY } from "./supabase-auth.helpers.mjs";

const settings = { SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY };

test("account availability needs only Supabase public configuration, D1, a strong secret and its exact origin", () => {
  const env = { ...settings, PUBLIC_ORIGIN: ORIGIN, DB: {}, SESSION_SECRET: SECRET };
  assert.equal(configuration(env, ORIGIN).authAvailable, true);
  assert.equal(configuration({ ...env, PUBLISHING_ENABLED: "false" }, ORIGIN).authAvailable, true);
  for (const change of [{ DB: null }, { SESSION_SECRET: "short" }, { SUPABASE_URL: "https://other.example" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_rejected" }, { PUBLIC_ORIGIN: "http://restyle.example" }])
    assert.equal(configuration({ ...env, ...change }, ORIGIN).authAvailable, false);
  assert.equal(configuration(env, "https://other.example").authAvailable, false);
});

test("session reads are read-only and logout revokes the account only from the editor origin", async () => {
  const f = await workerFixture(settings);
  try {
    const before = await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first();
    const session = await f.request("/api/auth/session");
    assert.equal(session.headers.get("Set-Cookie"), null);
    assert((await session.json()).user);
    assert.deepEqual(await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first(), before);
    assert.equal((await f.request("/api/auth/logout", { method: "POST", headers: { Origin: "https://attacker.example" } })).status, 403);
    assert.equal((await f.request("/api/auth/logout", { method: "GET" })).status, 405);
    const result = await f.request("/api/auth/logout", { method: "POST" });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("Set-Cookie"), /Max-Age=0/);
    assert.equal((await (await f.request("/api/auth/session")).json()).user, null);
  } finally { await f.close(); }
});

test("superseded direct Google and manual provider-link routes are absent", async () => {
  const f = await workerFixture(settings, { createSessions: false });
  try {
    for (const path of ["/api/auth/google/start", "/api/auth/google/callback", "/api/auth/supabase/link"])
      assert.equal((await f.request(path)).status, 404);
  } finally { await f.close(); }
});

test("account cookies have a dedicated audience and scheduled cleanup removes expired sessions", async () => {
  const signed = await signCookie({ token: "test" }, SECRET, "session", 900);
  assert.equal((await verifyCookie(signed, SECRET, "session")).token, "test");
  assert.equal(await verifyCookie(signed, SECRET, "other"), null);
  const f = await workerFixture(settings);
  try {
    await f.db.prepare("UPDATE sessions SET expires_at = 1").run();
    await cleanupAccountSessions({ DB: f.db });
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 2);
  } finally { await f.close(); }
});
