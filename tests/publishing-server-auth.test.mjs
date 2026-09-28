import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { verifyGoogleIdentity } from "../server/auth/google.js";
import { signCookie, verifyCookie } from "../server/auth/tokens.js";
import { authRoute } from "../server/auth/routes.js";
import { getSession } from "../server/auth/sessions.js";
import { configuration } from "../server/config.js";
import { workerFixture, ORIGIN, SECRET } from "./publishing-server.helpers.mjs";

test("Google identity requires valid signature, issuer, audience, expiry and login nonce", async () => {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "google-test", alg: "RS256" }] });
  const issue = (changes = {}, privateKey = pair.privateKey) => new SignJWT({ sub: "google-subject", name: "Alice", nonce: "nonce", ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).setIssuer("https://accounts.google.com")
    .setAudience("client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.deepEqual(await verifyGoogleIdentity(await issue(), keys, "client", "nonce"), { sub: "google-subject", name: "Alice" });
  await assert.rejects(verifyGoogleIdentity(await issue(), keys, "other-client", "nonce"));
  await assert.rejects(verifyGoogleIdentity(await issue(), keys, "client", "other-nonce"));
  await assert.rejects(verifyGoogleIdentity(await issue({ azp: "other-client" }), keys, "client", "nonce"));
  const otherPair = await generateKeyPair("RS256");
  await assert.rejects(verifyGoogleIdentity(await issue({}, otherPair.privateKey), keys, "client", "nonce"));
  const expired = await new SignJWT({ sub: "google-subject", nonce: "nonce" }).setProtectedHeader({ alg: "RS256", kid: "google-test" })
    .setIssuer("https://accounts.google.com").setAudience("client").setIssuedAt(1).setExpirationTime(2).sign(pair.privateKey);
  await assert.rejects(verifyGoogleIdentity(expired, keys, "client", "nonce"));
  const wrongIssuer = await new SignJWT({ sub: "google-subject", nonce: "nonce" }).setProtectedHeader({ alg: "RS256", kid: "google-test" })
    .setIssuer("https://attacker.example").setAudience("client").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
  await assert.rejects(verifyGoogleIdentity(wrongIssuer, keys, "client", "nonce"));
});

test("popup callback binds Google's token to the original login and creates a revocable session", async () => {
  const f = await workerFixture();
  try {
    const env = { DB: f.db, MEDIA: f.bucket, PUBLISHING_ENABLED: "true", PUBLIC_ORIGIN: ORIGIN,
      GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "test-provider-secret", SESSION_SECRET: SECRET };
    const config = configuration(env, ORIGIN);
    const login = await authRoute(new Request(`${ORIGIN}/api/auth/login`), env, config);
    assert.equal(login.status, 302);
    const destination = new URL(login.headers.get("Location"));
    assert.equal(destination.origin, "https://accounts.google.com");
    assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
    const stateCookie = login.headers.get("Set-Cookie").split(";", 1)[0];
    const state = await verifyCookie(stateCookie.slice(stateCookie.indexOf("=") + 1), SECRET, "oauth");
    const pair = await generateKeyPair("RS256");
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({ sub: "new-google-user", name: "New creator", nonce: state.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "google-key" }).setIssuer("https://accounts.google.com")
      .setAudience("client").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
    let exchanges = 0;
    const provider = async (url, options) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        exchanges += 1;
        const input = new URLSearchParams(options.body);
        assert.equal(input.get("redirect_uri"), `${ORIGIN}/api/auth/callback`);
        assert.equal(input.get("code_verifier"), state.verifier);
        assert.equal(input.get("client_secret"), env.GOOGLE_CLIENT_SECRET);
        return Response.json({ id_token: token });
      }
      assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
      return Response.json({ keys: [{ ...jwk, alg: "RS256", kid: "google-key" }] });
    };
    const forged = await authRoute(new Request(`${ORIGIN}/api/auth/callback?code=code&state=wrong`,
      { headers: { Cookie: stateCookie } }), env, config, provider);
    assert.equal(forged.status, 400);
    assert.equal(exchanges, 0);
    const callback = await authRoute(new Request(`${ORIGIN}/api/auth/callback?code=code&state=${state.state}`,
      { headers: { Cookie: stateCookie } }), env, config, provider);
    assert.equal(callback.status, 200);
    const html = await callback.text();
    assert(html.includes(`ok:true},"${ORIGIN}"`));
    assert(!html.includes(token));
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith("__Host-restyle-session="));
    assert(cookie.includes("HttpOnly; Secure; SameSite=Lax"));
    const user = await getSession(new Request(ORIGIN, { headers: { Cookie: cookie.split(";", 1)[0] } }), env);
    assert.equal(user.name, "New creator");
  } finally { await f.close(); }
});

test("signed state and session cookies cannot be substituted or forged", async () => {
  const secret = "test-cookie-secret-at-least-thirty-two-characters";
  const token = await signCookie({ token: "session" }, secret, "session", 600);
  assert.equal((await verifyCookie(token, secret, "session")).token, "session");
  assert.equal(await verifyCookie(token, secret, "oauth"), null);
  assert.equal(await verifyCookie(token, secret + "other", "session"), null);
  assert.equal(await verifyCookie(token.slice(0, -8) + "tampered", secret, "session"), null);
});
