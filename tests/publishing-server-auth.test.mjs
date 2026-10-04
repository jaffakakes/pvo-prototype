import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { verifyGoogleIdentity } from "../server/auth/google.js";
import { signCookie, verifyCookie } from "../server/auth/tokens.js";
import { authRoute } from "../server/auth/routes.js";
import { cleanupAccountSessions, createAccountSession, getAccountSession } from "../server/auth/sessions.js";
import { configuration } from "../server/config.js";
import { digest, randomId } from "../server/identity.js";
import { workerFixture, ORIGIN, SECRET, tinyMp4 } from "./publishing-server.helpers.mjs";

const sessionCookieName = "__Host-pvo-session";

async function googleToken(pair, nonce, changes = {}) {
  return new SignJWT({ sub: "google-subject", name: "Alice", nonce, ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com")
    .setAudience("client").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
}

test("Google identity requires the correct signature, audience, issuer, expiry and login nonce", async () => {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "google-test", alg: "RS256" }] });
  assert.deepEqual(await verifyGoogleIdentity(await googleToken(pair, "nonce"), keys, "client", "nonce"),
    { sub: "google-subject", name: "Alice" });
  await assert.rejects(verifyGoogleIdentity(await googleToken(pair, "nonce"), keys, "other-client", "nonce"));
  await assert.rejects(verifyGoogleIdentity(await googleToken(pair, "nonce"), keys, "client", "wrong-nonce"));
  await assert.rejects(verifyGoogleIdentity(await googleToken(pair, "nonce", { azp: "other-client" }), keys, "client", "nonce"));
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifyGoogleIdentity(await googleToken(other, "nonce"), keys, "client", "nonce"));
  const expired = await new SignJWT({ sub: "google-subject", nonce: "nonce" })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com")
    .setAudience("client").setIssuedAt(1).setExpirationTime(2).sign(pair.privateKey);
  await assert.rejects(verifyGoogleIdentity(expired, keys, "client", "nonce"));
  const wrongIssuer = await new SignJWT({ sub: "google-subject", nonce: "nonce" })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://attacker.example")
    .setAudience("client").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
  await assert.rejects(verifyGoogleIdentity(wrongIssuer, keys, "client", "nonce"));
});

test("Google callback creates a revocable account session and reuses the provider identity", async () => {
  const f = await workerFixture({ GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "test-provider-secret" },
    { createSessions: false });
  try {
    const env = { DB: f.db, PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "test-provider-secret" };
    const config = configuration(env, ORIGIN);
    const pair = await generateKeyPair("RS256");
    const jwk = await exportJWK(pair.publicKey);
    let exchanges = 0;
    async function start() {
      const response = await authRoute(new Request(`${ORIGIN}/api/auth/google/start`), env, config);
      assert.equal(response.status, 302);
      const destination = new URL(response.headers.get("Location"));
      assert.equal(destination.origin, "https://accounts.google.com");
      assert.equal(destination.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
      assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
      const cookie = response.headers.get("Set-Cookie").split(";", 1)[0];
      const state = await verifyCookie(cookie.slice(cookie.indexOf("=") + 1), SECRET, "oauth");
      assert.equal(destination.searchParams.get("state"), state.state);
      assert.equal(destination.searchParams.get("nonce"), state.nonce);
      return { cookie, state };
    }
    const provider = async (url, options) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        exchanges += 1;
        const input = new URLSearchParams(options.body);
        assert.equal(input.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
        assert.equal(input.get("client_secret"), env.GOOGLE_CLIENT_SECRET);
        assert.equal(input.get("code_verifier"), pending.state.verifier);
        return Response.json({ id_token: await googleToken(pair, pending.state.nonce) });
      }
      assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
      return Response.json({ keys: [{ ...jwk, alg: "RS256", kid: "google-test" }] });
    };
    let pending = await start();
    const invalid = await authRoute(new Request(`${ORIGIN}/api/auth/google/callback?code=code&state=wrong`,
      { headers: { Cookie: pending.cookie } }), env, config, provider);
    assert.equal(invalid.status, 400);
    assert.equal(exchanges, 0);
    const callback = await authRoute(new Request(`${ORIGIN}/api/auth/google/callback?code=code&state=${pending.state.state}`,
      { headers: { Cookie: pending.cookie } }), env, config, provider);
    assert.equal(callback.status, 200);
    assert((await callback.text()).includes(`postMessage({type:"pvo:auth:complete",ok:true},"${ORIGIN}")`));
    const cookieHeader = callback.headers.getSetCookie().find(value => value.startsWith(`${sessionCookieName}=`));
    assert(cookieHeader.includes("HttpOnly; Secure; SameSite=Lax"));
    const cookie = cookieHeader.split(";", 1)[0];
    const request = new Request(`${ORIGIN}/api/auth/session`, { headers: { Cookie: cookie } });
    const first = await getAccountSession(request, env);
    assert.equal(first.name, "Alice");
    assert.deepEqual(await (await f.request("/api/auth/session", { session: cookie })).json(),
      { available: true, user: first });
    pending = await start();
    const second = await authRoute(new Request(`${ORIGIN}/api/auth/google/callback?code=code2&state=${pending.state.state}`,
      { headers: { Cookie: pending.cookie } }), env, config, provider);
    assert.equal(second.status, 200);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM provider_identities").first()).count, 1);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 2);
    const secondCookie = second.headers.getSetCookie().find(value => value.startsWith(`${sessionCookieName}=`)).split(";", 1)[0];
    assert.equal((await getAccountSession(new Request(ORIGIN, { headers: { Cookie: secondCookie } }), env)).id, first.id);
    const logout = await authRoute(new Request(`${ORIGIN}/api/auth/logout`, {
      method: "POST", headers: { Origin: ORIGIN, Cookie: cookie },
    }), env, config);
    assert.deepEqual(await logout.json(), { user: null });
    assert(logout.headers.get("Set-Cookie").startsWith(`${sessionCookieName}=;`));
    assert.equal(await getAccountSession(request, env), null);
    assert.equal((await getAccountSession(new Request(ORIGIN, { headers: { Cookie: secondCookie } }), env)).id, first.id);
    const secondToken = await verifyCookie(secondCookie.slice(secondCookie.indexOf("=") + 1), SECRET, "session");
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE token_hash = ?")
      .bind(await digest(secondToken.token)).run();
    assert.equal(await getAccountSession(new Request(ORIGIN, { headers: { Cookie: secondCookie } }), env), null);
  } finally { await f.close(); }
});

test("session reads are read-only, unconfigured sign-in is unavailable, and logout requires the editor origin", async () => {
  const f = await workerFixture({}, { createSessions: false });
  try {
    const env = { DB: f.db, PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: SECRET };
    const config = configuration(env, ORIGIN);
    assert.equal(config.authAvailable, false);
    assert.deepEqual(await (await authRoute(new Request(`${ORIGIN}/api/auth/session`), env, config)).json(),
      { available: false, user: null });
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
    await assert.rejects(authRoute(new Request(`${ORIGIN}/api/auth/google/start`), env, config),
      error => error.status === 503);
    for (const origin of ["", "null", "https://attacker.example"]) {
      await assert.rejects(authRoute(new Request(`${ORIGIN}/api/auth/logout`, {
        method: "POST", headers: { Origin: origin },
      }), env, config), error => error.status === 403);
    }
    assert.equal(configuration({ ...env, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" },
      "https://other.example").authAvailable, false);
  } finally { await f.close(); }
});

test("signed OAuth state and account cookies have separate audiences", async () => {
  const token = await signCookie({ token: "session" }, SECRET, "session", 600);
  assert.equal((await verifyCookie(token, SECRET, "session")).token, "session");
  assert.equal(await verifyCookie(token, SECRET, "oauth"), null);
  assert.equal(await verifyCookie(token, `${SECRET}-other`, "session"), null);
  assert.equal(await verifyCookie(`${token.slice(0, -8)}tampered`, SECRET, "session"), null);
});

test("scheduled account cleanup removes expired sessions without depending on media storage", async () => {
  const f = await workerFixture({}, { createSessions: false });
  try {
    const env = { DB: f.db, SESSION_SECRET: SECRET };
    await createAccountSession({ sub: "cleanup-subject", name: "Creator" }, env);
    await f.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind("expired-token", (await f.db.prepare("SELECT id FROM users").first()).id, 1).run();
    await cleanupAccountSessions(env);
    const { results } = await f.db.prepare("SELECT token_hash FROM sessions").all();
    assert.equal(results.length, 1);
    assert.notEqual(results[0].token_hash, "expired-token");
  } finally { await f.close(); }
});

test("apex sign-in is canonical while existing workers.dev publication links remain readable", async () => {
  const deployment = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const origin = "https://getrestyle.app";
  const legacyOrigin = "https://lingering-butterfly-9ba8.jaffakakes28.workers.dev";
  assert.equal(deployment.vars.PUBLIC_ORIGIN, origin);
  assert.equal(deployment.workers_dev, true);

  const f = await workerFixture({ PUBLIC_ORIGIN: origin, GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "test-provider-secret" }, { createSessions: false });
  try {
    const cookie = (await createAccountSession({ sub: "legacy-publication-owner", name: "Creator" },
      { DB: f.db, SESSION_SECRET: SECRET })).split(";", 1)[0];
    const account = await f.mf.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await account.json()).user.name, "Creator");
    const publishing = await f.mf.dispatchFetch(`${origin}/api/publishing`, { headers: { Cookie: cookie } });
    assert.deepEqual(await publishing.json(), { available: true, hasSession: true, maxBytes: 52428800 });
    const legacyAccount = await f.mf.dispatchFetch(`${legacyOrigin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.deepEqual(await legacyAccount.json(), { available: false, user: null });
    const legacyPublishing = await f.mf.dispatchFetch(`${legacyOrigin}/api/publishing`, { headers: { Cookie: cookie } });
    assert.equal((await legacyPublishing.json()).available, false);

    const id = randomId();
    const key = `exports/${id}/video.mp4`;
    const file = tinyMp4();
    const now = Date.now();
    const owner = await f.db.prepare("SELECT id FROM users").first();
    await f.bucket.put(key, file);
    await f.db.prepare(`INSERT INTO publications (id, owner_id, idempotency_key, title, filename, format,
      content_type, bytes, status, object_key, created_at, expires_at)
      VALUES (?, ?, ?, 'Legacy video', 'video.mp4', 'video', 'video/mp4', ?, 'ready', ?, ?, ?)`)
      .bind(id, owner.id, randomId(), file.size, key, now, now + 86400000).run();
    const player = await f.mf.dispatchFetch(`${legacyOrigin}/player/${id}`);
    assert.equal(player.status, 200);
    assert((await player.text()).includes(`${legacyOrigin}/media/${id}`));
    const media = await f.mf.dispatchFetch(`${legacyOrigin}/media/${id}`);
    assert.equal(media.status, 200);
    assert.equal((await media.arrayBuffer()).byteLength, file.size);
  } finally { await f.close(); }
});
