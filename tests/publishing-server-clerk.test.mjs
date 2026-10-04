import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyClerkIdentity } from "../server/auth/clerk.js";
import { workerFixture, ORIGIN, SECRET } from "./publishing-server.helpers.mjs";

const ISSUER = "https://restyle-test.clerk.accounts.dev";
const PUBLISHABLE_KEY = "pk_test_restyle-test";

async function fixtureKeys() {
  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "clerk-test" };
  return { pair, jwk, keys: createLocalJWKSet({ keys: [jwk] }) };
}

async function token(pair, changes = {}) {
  const { issuer = ISSUER, azp = ORIGIN, sub = "user_clerktest1", sid = "sess_clerktest1",
    status = "active", omitStatus = false, name,
    issuedAt = Math.floor(Date.now() / 1000), expiresAt = issuedAt + 60 } = changes;
  return new SignJWT({ azp, sub, sid, ...(!omitStatus && { sts: status }), ...(name ? { name } : {}) })
    .setProtectedHeader({ alg: "RS256", kid: "clerk-test" })
    .setIssuer(issuer).setIssuedAt(issuedAt).setNotBefore(issuedAt - 1)
    .setExpirationTime(expiresAt).sign(pair.privateKey);
}

function clerkRequest(bearer, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  return { method: "POST", ...requestOptions, headers: { Authorization: `Bearer ${bearer}`, ...headers } };
}

function clerkLinkRequest(bearer, expectedUserId, options = {}) {
  const request = clerkRequest(bearer, options);
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

test("Clerk tokens require a fresh signed session from the exact issuer and editor origin", async () => {
  const { pair, keys } = await fixtureKeys();
  assert.deepEqual(await verifyClerkIdentity(await token(pair, { name: "Ada" }), keys, ISSUER, ORIGIN),
    { issuer: ISSUER, sub: "user_clerktest1", sid: "sess_clerktest1", name: "Ada" });
  assert.deepEqual(await verifyClerkIdentity(await token(pair, { omitStatus: true }), keys, ISSUER, ORIGIN),
    { issuer: ISSUER, sub: "user_clerktest1", sid: "sess_clerktest1", name: "Creator" },
    "A normal personal-account token may omit Clerk's optional status claim");
  const invalid = [
    { issuer: "https://other.clerk.accounts.dev" },
    { azp: "https://attacker.example" },
    { sub: "" },
    { sid: "" },
    { status: null },
    { status: "pending" },
    { status: "ended" },
    { status: "revoked" },
    { status: "unknown" },
    { issuedAt: Math.floor(Date.now() / 1000) - 180, expiresAt: Math.floor(Date.now() / 1000) + 30 },
    { expiresAt: 1 },
  ];
  for (const change of invalid)
    await assert.rejects(verifyClerkIdentity(await token(pair, change), keys, ISSUER, ORIGIN),
      error => error.status === 401);
  const other = await fixtureKeys();
  await assert.rejects(verifyClerkIdentity(await token(other.pair), keys, ISSUER, ORIGIN),
    error => error.status === 401);
});

test("Clerk exchange creates only an identity mapping and a short-lived Restyle session", async () => {
  const { pair, jwk } = await fixtureKeys();
  const outbound = async request => {
    assert.equal(request.url, `${ISSUER}/.well-known/jwks.json`);
    return Response.json({ keys: [jwk] });
  };
  const f = await workerFixture({ CLERK_ISSUER: ISSUER, CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { createSessions: false, outboundService: outbound });
  try {
    const initial = await f.request("/api/auth/session");
    assert.deepEqual(await initial.json(), { available: false, clerkAvailable: true,
      clerkPublishableKey: PUBLISHABLE_KEY, canLinkEmail: false, emailLinked: false, user: null });
    const jwt = await token(pair, { name: "Ada" });
    const first = await f.request("/api/auth/clerk/exchange", clerkRequest(jwt));
    assert.equal(first.status, 200);
    const user = (await first.json()).user;
    assert.equal(user.name, "Ada");
    assert.match(user.id, /^[A-Za-z0-9_-]{22}$/);
    const cookie = first.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-pvo-session=.+; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$/);
    assert.equal(decodeJwt(cookie.split(";", 1)[0].split("=", 2)[1]).authMethod, "clerk");
    const session = await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] });
    assert.deepEqual(await session.json(), { available: false, clerkAvailable: true,
      clerkPublishableKey: PUBLISHABLE_KEY, canLinkEmail: false, emailLinked: true, user });
    const again = await f.request("/api/auth/clerk/exchange", clerkRequest(jwt));
    assert.equal((await again.json()).user.id, user.id);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM managed_identities").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM provider_identities").first()).count, 0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 2);
    const rows = (await f.db.prepare("SELECT expires_at FROM sessions").all()).results;
    assert(rows.every(row => row.expires_at <= Date.now() + 15 * 60 * 1000));
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(user.id).run();
    assert.equal((await (await f.request("/api/auth/session", { session: cookie.split(";", 1)[0] })).json()).user, null);
  } finally { await f.close(); }
});

test("Clerk account linking requires a Google account and never merges by matching names", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ CLERK_ISSUER: ISSUER, CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    GOOGLE_CLIENT_ID: "test-google-client", GOOGLE_CLIENT_SECRET: "test-google-secret" },
    { outboundService: async () => Response.json({ keys: [jwk] }) });
  try {
    const googleSession = await (await f.request("/api/auth/session")).json();
    const googleUser = googleSession.user;
    assert.equal(googleSession.canLinkEmail, true);
    assert.equal(googleSession.emailLinked, false);
    assert.equal(decodeJwt(f.cookie.split("=", 2)[1]).authMethod, "google");
    const jwt = await token(pair, { name: "First creator" });
    const missingGoogleSession = await f.request("/api/auth/clerk/link",
      { ...clerkLinkRequest(jwt, googleUser.id), session: null });
    assert.equal(missingGoogleSession.status, 403);
    const noImplicitLink = await f.request("/api/auth/clerk/exchange",
      { ...clerkRequest(jwt), session: null });
    assert.equal(noImplicitLink.status, 200);
    const clerkUser = (await noImplicitLink.json()).user;
    assert.notEqual(clerkUser.id, googleUser.id);
    const conflictingLink = await f.request("/api/auth/clerk/link", clerkLinkRequest(jwt, googleUser.id));
    assert.equal(conflictingLink.status, 409);

    const fresh = await token(pair, { sub: "user_newaccount", sid: "sess_newaccount" });
    const changedAccount = await f.request("/api/auth/clerk/link",
      { ...clerkLinkRequest(fresh, googleUser.id), session: f.otherCookie });
    assert.equal(changedAccount.status, 412);
    const linked = await f.request("/api/auth/clerk/link", clerkLinkRequest(fresh, googleUser.id));
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).user.id, googleUser.id);
    const linkedSession = await (await f.request("/api/auth/session")).json();
    assert.equal(linkedSession.canLinkEmail, false);
    assert.equal(linkedSession.emailLinked, true);
    const emailSignIn = await f.request("/api/auth/clerk/exchange",
      { ...clerkRequest(fresh), session: null });
    assert.equal((await emailSignIn.json()).user.id, googleUser.id);
    const otherUser = (await (await f.request("/api/auth/session", { session: f.otherCookie })).json()).user;
    const otherGoogle = await f.request("/api/auth/clerk/link",
      { ...clerkLinkRequest(fresh, otherUser.id), session: f.otherCookie });
    assert.equal(otherGoogle.status, 409);
  } finally { await f.close(); }
});

test("linking rejects old Google cookies and stale Google reauthentication", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ CLERK_ISSUER: ISSUER, CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { outboundService: async () => Response.json({ keys: [jwk] }) });
  try {
    const owner = (await (await f.request("/api/auth/session")).json()).user;
    const jwt = await token(pair);
    for (const session of [
      await reissueGoogleCookie(f.cookie, { legacy: true }),
      await reissueGoogleCookie(f.cookie, { ageSeconds: 301 }),
    ]) {
      assert.equal((await (await f.request("/api/auth/session", { session })).json()).user.id, owner.id);
      assert.equal((await f.request("/api/auth/clerk/link",
        { ...clerkLinkRequest(jwt, owner.id), session })).status, 403);
    }
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM managed_identities").first()).count, 0);
  } finally { await f.close(); }
});

test("Clerk exchange rejects missing tokens, cross-origin requests and unconfigured instances", async () => {
  const { pair, jwk } = await fixtureKeys();
  const f = await workerFixture({ CLERK_ISSUER: ISSUER, CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY },
    { createSessions: false, outboundService: async () => Response.json({ keys: [jwk] }) });
  try {
    const jwt = await token(pair);
    assert.equal((await f.request("/api/auth/clerk/exchange", { method: "POST" })).status, 401);
    assert.equal((await f.request("/api/auth/clerk/exchange", clerkRequest(jwt,
      { headers: { Origin: "https://attacker.example" } }))).status, 403);
    assert.equal((await f.request("/api/auth/clerk/exchange", clerkRequest(jwt,
      { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
    assert.equal((await f.request("/api/auth/clerk/exchange", { method: "GET" })).status, 405);
  } finally { await f.close(); }
  const unconfigured = await workerFixture({}, { createSessions: false });
  try {
    assert.equal((await unconfigured.request("/api/auth/clerk/exchange", { method: "POST" })).status, 503);
  } finally { await unconfigured.close(); }
});
