import test from "node:test";
import assert from "node:assert/strict";
import { verifySupabaseIdentity } from "../server/auth/supabase.js";
import { workerFixture, ORIGIN } from "./publishing-server.helpers.mjs";

import { PROJECT_URL, ISSUER, PUBLISHABLE_KEY, SUBJECT, SESSION, fixtureKeys, token, authService } from "./supabase-auth.helpers.mjs";

function supabaseRequest(bearer, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  return { method: "POST", ...requestOptions, headers: { Authorization: `Bearer ${bearer}`, ...headers } };
}

test("Supabase tokens require the exact project, audience, authenticated role and a signed non-anonymous session", async () => {
  for (const algorithm of ["ES256", "RS256"]) {
    const { pair, keys } = await fixtureKeys(algorithm);
    assert.deepEqual(await verifySupabaseIdentity(await token(pair, {}, algorithm), keys, ISSUER),
      { issuer: ISSUER, sub: SUBJECT, sid: SESSION });
    for (const change of [
      { issuer: "https://other.supabase.co/auth/v1" }, { audience: "other" }, { sub: "" }, { sid: "" },
      { role: "service_role" }, { role: "anon" }, { anonymous: true }, { expiresAt: 1 },
    ]) await assert.rejects(verifySupabaseIdentity(await token(pair, change, algorithm), keys, ISSUER), error => error.status === 401);
    const other = await fixtureKeys(algorithm);
    await assert.rejects(verifySupabaseIdentity(await token(other.pair, {}, algorithm), keys, ISSUER), error => error.status === 401);
  }
});

test("Supabase exchange creates only an identity mapping and a short-lived Restyle session", async () => {
  const { pair, jwk } = await fixtureKeys();
  const currentUser = { app_metadata: { provider: "email" } };
  const outbound = authService(jwk, currentUser);
  const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { createSessions: false, outboundService: outbound });
  try {
    const initial = await f.request("/api/auth/session");
    assert.deepEqual(await initial.json(), { available: true, supabaseAvailable: true,
      supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, user: null });
    const jwt = await token(pair, { name: "Ada" });
    const first = await f.request("/api/auth/supabase/exchange", supabaseRequest(jwt));
    assert.equal(first.status, 200);
    const user = (await first.json()).user;
    assert.equal(user.name, "Ada");
    assert.match(user.id, /^[A-Za-z0-9_-]{22}$/);
    const cookie = first.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-pvo-session=.+; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$/);
    const session = await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] });
    assert.deepEqual(await session.json(), { available: true, supabaseAvailable: true,
      supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, user });
    currentUser.app_metadata.provider = "google";
    const googleToken = await token(pair, { sid: "44444444-4444-4444-8444-444444444444" });
    const again = await f.request("/api/auth/supabase/exchange", supabaseRequest(googleToken));
    assert.equal((await again.json()).user.id, user.id, "Google and password sessions for one Supabase UUID share one Restyle account");
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM supabase_identities").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 2);
    const rows = (await f.db.prepare("SELECT expires_at FROM sessions").all()).results;
    assert(rows.every(row => row.expires_at <= Date.now() + 15 * 60 * 1000));
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(user.id).run();
    assert.equal((await (await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] })).json()).user, null);
  } finally { await f.close(); }
});

test("Supabase exchange rejects missing tokens, cross-origin requests and unconfigured instances", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { createSessions: false, outboundService: authService(jwk) });
  try {
    const jwt = await token(pair);
    assert.equal((await f.request("/api/auth/supabase/exchange", { method: "POST" })).status, 401);
    assert.equal((await f.request("/api/auth/supabase/exchange", supabaseRequest(jwt,
      { headers: { Origin: "https://attacker.example" } }))).status, 403);
    assert.equal((await f.request("/api/auth/supabase/exchange", supabaseRequest(jwt,
      { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
    assert.equal((await f.request("/api/auth/supabase/exchange", { method: "GET" })).status, 405);
  } finally { await f.close(); }
  const unconfigured = await workerFixture({}, { createSessions: false });
  try {
    assert.equal((await unconfigured.request("/api/auth/supabase/exchange", { method: "POST" })).status, 503);
  } finally { await unconfigured.close(); }
});

test("Supabase exchange rejects unconfirmed, anonymous or mismatched live users", async () => {
  const { pair, jwk } = await fixtureKeys();
  for (const change of [{ email_confirmed_at: null }, { is_anonymous: true }, { id: "another-user" }, { email: "" }]) {
    const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
      { createSessions: false, outboundService: authService(jwk, change) });
    try {
      assert.equal((await f.request("/api/auth/supabase/exchange", supabaseRequest(await token(pair)))).status, 401);
      assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
    } finally { await f.close(); }
  }
});
