import test from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, SignJWT } from "jose";
import { verifySupabaseIdentity } from "../server/auth/supabase.js";
import { workerFixture, ORIGIN, SECRET } from "./publishing-server.helpers.mjs";

import { PROJECT_URL, ISSUER, PUBLISHABLE_KEY, SUBJECT, SESSION, fixtureKeys, token, authService } from "./supabase-auth.helpers.mjs";

function supabaseRequest(bearer, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  return { method: "POST", ...requestOptions, headers: { Authorization: `Bearer ${bearer}`, ...headers } };
}

function supabaseLinkRequest(bearer, expectedUserId, options = {}) {
  const request = supabaseRequest(bearer, options);
  return { ...request, body: JSON.stringify({ expectedUserId }),
    headers: { ...request.headers, "Content-Type": "application/json" } };
}

async function reissueGoogleCookie(cookie, { ageSeconds = 0, legacy = false } = {}) {
  const original = decodeJwt(cookie.split("=", 2)[1]);
  const issuedAt = Math.floor(Date.now() / 1000) - ageSeconds;
  const payload = { token: original.token, ...(!legacy && { authMethod: "google" }) };
  const signed = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" })
    .setIssuer("pvo-auth").setAudience("session").setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 7 * 24 * 60 * 60)
    .sign(new TextEncoder().encode(SECRET));
  return `__Host-pvo-session=${signed}`;
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
  const outbound = authService(jwk);
  const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { createSessions: false, outboundService: outbound });
  try {
    const initial = await f.request("/api/auth/session");
    assert.deepEqual(await initial.json(), { available: false, supabaseAvailable: true,
      supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, canLinkEmail: false, emailLinked: false, user: null });
    const jwt = await token(pair, { name: "Ada" });
    const first = await f.request("/api/auth/supabase/exchange", supabaseRequest(jwt));
    assert.equal(first.status, 200);
    const user = (await first.json()).user;
    assert.equal(user.name, "Ada");
    assert.match(user.id, /^[A-Za-z0-9_-]{22}$/);
    const cookie = first.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-pvo-session=.+; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$/);
    assert.equal(decodeJwt(cookie.split(";", 1)[0].split("=", 2)[1]).authMethod, "supabase");
    const session = await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] });
    assert.deepEqual(await session.json(), { available: false, supabaseAvailable: true,
      supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, canLinkEmail: false, emailLinked: true, user });
    const again = await f.request("/api/auth/supabase/exchange", supabaseRequest(jwt));
    assert.equal((await again.json()).user.id, user.id);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM supabase_identities").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM provider_identities").first()).count, 0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 2);
    const rows = (await f.db.prepare("SELECT expires_at FROM sessions").all()).results;
    assert(rows.every(row => row.expires_at <= Date.now() + 15 * 60 * 1000));
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(user.id).run();
    assert.equal((await (await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] })).json()).user, null);
  } finally { await f.close(); }
});

test("Supabase account linking requires a Google account and never merges by matching names", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-google-secret" },
    { outboundService: authService(jwk) });
  try {
    const googleSession = await (await f.request("/api/auth/session")).json();
    const googleUser = googleSession.user;
    assert.equal(googleSession.canLinkEmail, true);
    assert.equal(googleSession.emailLinked, false);
    assert.equal(decodeJwt(f.cookie.split("=", 2)[1]).authMethod, "google");
    const jwt = await token(pair, { name: "First creator" });
    const missingGoogleSession = await f.request("/api/auth/supabase/link",
      { ...supabaseLinkRequest(jwt, googleUser.id), session: null });
    assert.equal(missingGoogleSession.status, 403);
    const noImplicitLink = await f.request("/api/auth/supabase/exchange",
      { ...supabaseRequest(jwt), session: null });
    assert.equal(noImplicitLink.status, 200);
    const supabaseUser = (await noImplicitLink.json()).user;
    assert.notEqual(supabaseUser.id, googleUser.id);
    const conflictingLink = await f.request("/api/auth/supabase/link", supabaseLinkRequest(jwt, googleUser.id));
    assert.equal(conflictingLink.status, 409);

    const fresh = await token(pair, { sub: "33333333-3333-4333-8333-333333333333", sid: SESSION });
    const changedAccount = await f.request("/api/auth/supabase/link",
      { ...supabaseLinkRequest(fresh, googleUser.id), session: f.otherCookie });
    assert.equal(changedAccount.status, 412);
    const linked = await f.request("/api/auth/supabase/link", supabaseLinkRequest(fresh, googleUser.id));
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).user.id, googleUser.id);
    const linkedSession = await (await f.request("/api/auth/session")).json();
    assert.equal(linkedSession.canLinkEmail, false);
    assert.equal(linkedSession.emailLinked, true);
    const emailSignIn = await f.request("/api/auth/supabase/exchange",
      { ...supabaseRequest(fresh), session: null });
    assert.equal((await emailSignIn.json()).user.id, googleUser.id);
    const otherUser = (await (await f.request("/api/auth/session", { session: f.otherCookie })).json()).user;
    const otherGoogle = await f.request("/api/auth/supabase/link",
      { ...supabaseLinkRequest(fresh, otherUser.id), session: f.otherCookie });
    assert.equal(otherGoogle.status, 409);
  } finally { await f.close(); }
});

test("linking rejects old Google cookies and stale Google reauthentication", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ SUPABASE_URL: PROJECT_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { outboundService: authService(jwk) });
  try {
    const owner = (await (await f.request("/api/auth/session")).json()).user;
    const jwt = await token(pair);
    for (const session of [
      await reissueGoogleCookie(f.cookie, { legacy: true }),
      await reissueGoogleCookie(f.cookie, { ageSeconds: 301 }),
    ]) {
      assert.equal((await (await f.request("/api/auth/session", { session })).json()).user.id, owner.id);
      assert.equal((await f.request("/api/auth/supabase/link",
        { ...supabaseLinkRequest(jwt, owner.id), session })).status, 403);
    }
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM supabase_identities").first()).count, 0);
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
