import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createLocalAuthApi } from "../scripts/dev/local-auth.mjs";

async function beta(directory, options = {}) {
  let api;
  const server = createServer(async (request, response) => {
    try { await api.handle(request, response, new URL(request.url, `http://${request.headers.host}`).pathname); }
    catch (error) { response.writeHead(500).end(String(error)); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { api = await createLocalAuthApi({ directory, origin, ...options }); }
  catch (error) { server.close(); throw error; }
  return {
    origin,
    request(path, { method = "GET", cookie, headers = {} } = {}) {
      return fetch(`${origin}${path}`, { method, redirect: "manual",
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === "POST" ? { Origin: origin } : {}), ...headers } });
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function cookieFor(response, name) {
  return response.headers.getSetCookie().map(value => value.split(";", 1)[0])
    .find(value => value.startsWith(`${name}=`));
}

test("loopback auth reports unavailable without Google credentials", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await beta(directory);
  t.after(() => app.close());
  const session = await app.request("/api/auth/session");
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { available: false, user: null });
  assert.equal((await app.request("/api/auth/google/start")).status, 503);
});

test("loopback Google sign-in verifies identity, persists a private account, and revokes logout", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  let nonce;
  let tokenCalls = 0;
  const fetcher = async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1;
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("client_id"), "test-client");
      assert.equal(body.get("client_secret"), "test-secret");
      assert.equal(body.get("code"), "google-code");
      assert.match(body.get("code_verifier"), /^[A-Za-z0-9_-]+$/);
      assert.match(body.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/google\/callback$/);
      const idToken = await new SignJWT({ sub: "google-sub-private", name: "Ada Creator", nonce })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer("https://accounts.google.com").setAudience("test-client")
        .setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [jwk] });
    throw new Error("Unexpected Google request.");
  };
  let app = await beta(directory, { clientId: "test-client", clientSecret: "test-secret", fetcher });
  t.after(async () => { await app?.close(); });
  assert.deepEqual(await (await app.request("/api/auth/session")).json(), { available: true, user: null });

  const start = await app.request("/api/auth/google/start");
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get("location"));
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("scope"), "openid profile");
  assert.equal(authorization.searchParams.get("redirect_uri"), `${app.origin}/api/auth/google/callback`);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorization.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  nonce = authorization.searchParams.get("nonce");
  const state = authorization.searchParams.get("state");
  const oauthCookie = cookieFor(start, "pvo-local-oauth");
  assert(oauthCookie);
  assert.match(start.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);

  const forged = await app.request("/api/auth/google/callback?code=google-code&state=wrong", { cookie: oauthCookie });
  assert.equal(forged.status, 400);
  assert.equal(tokenCalls, 0);
  const callback = await app.request(`/api/auth/google/callback?code=google-code&state=${state}`,
    { cookie: oauthCookie });
  assert.equal(callback.status, 200);
  assert.equal(tokenCalls, 1);
  assert.match(await callback.text(), /pvo:auth:complete/);
  const sessionCookie = cookieFor(callback, "pvo-local-session");
  assert(sessionCookie);
  assert.match(callback.headers.getSetCookie().find(value => value.startsWith("pvo-local-session=")),
    /HttpOnly; SameSite=Lax/);
  const signedIn = await (await app.request("/api/auth/session", { cookie: sessionCookie })).json();
  assert.equal(signedIn.available, true);
  assert.equal(signedIn.user.name, "Ada Creator");
  assert.match(signedIn.user.id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await app.request("/api/auth/session")).status, 200);

  const accountPath = join(directory, "auth-accounts.json");
  const stored = await readFile(accountPath, "utf8");
  assert(!stored.includes("google-sub-private"));
  assert(!stored.includes(sessionCookie.split("=", 2)[1]));
  assert.equal((await stat(accountPath)).mode & 0o077, 0);
  assert.equal((await stat(join(directory, "auth-secret"))).mode & 0o077, 0);
  await app.close();
  app = null;
  app = await beta(directory, { clientId: "test-client", clientSecret: "test-secret", fetcher });
  assert.deepEqual((await (await app.request("/api/auth/session", { cookie: sessionCookie })).json()).user,
    signedIn.user);
  assert.equal((await app.request("/api/auth/logout", { method: "POST", cookie: sessionCookie,
    headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await app.request("/api/auth/logout", { method: "POST", cookie: sessionCookie })).status, 200);
  assert.deepEqual(await (await app.request("/api/auth/session", { cookie: sessionCookie })).json(),
    { available: true, user: null });
});

test("loopback Google client file must be private and valid", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "google-client.json");
  await writeFile(path, JSON.stringify({ clientId: "file-client", clientSecret: "file-secret" }), { mode: 0o644 });
  await assert.rejects(beta(directory), /mode-0600/);
  await rm(path);
  await writeFile(path, JSON.stringify({ clientId: "file-client", clientSecret: "file-secret" }), { mode: 0o600 });
  const app = await beta(directory);
  t.after(() => app.close());
  assert.deepEqual(await (await app.request("/api/auth/session")).json(), { available: true, user: null });
});
