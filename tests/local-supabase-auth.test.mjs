import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalAuthApi } from "../scripts/dev/local-auth.mjs";
import { createLocalAuthStore } from "../scripts/dev/local-auth-store.mjs";

import { PROJECT_URL, ISSUER, PUBLISHABLE_KEY, SUBJECT, fixtureKeys, token as signedToken, authService } from "./supabase-auth.helpers.mjs";

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
    request(path, { method = "GET", token, cookie, headers = {} } = {}) {
      return fetch(`${origin}${path}`, { method, redirect: "manual", headers: {
        ...(method === "POST" ? { Origin: origin } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      } });
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function sessionCookie(response) {
  const header = response.headers.getSetCookie().find(value => value.startsWith("pvo-local-session="));
  return header?.split(";", 1)[0];
}

test("loopback beta exchanges a verified Supabase session for a short-lived local account", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-supabase-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { pair, jwk } = await fixtureKeys();
  const fetcher = authService(jwk);
  const options = { supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, fetcher };
  let app = await beta(directory, options);
  t.after(async () => { await app?.close(); });

  assert.deepEqual(await (await app.request("/api/auth/session")).json(), {
    available: false, supabaseAvailable: true, supabasePublishableKey: PUBLISHABLE_KEY, supabaseUrl: PROJECT_URL, canLinkEmail: false, emailLinked: false, user: null,
  });
  assert.equal((await app.request("/api/auth/google/start")).status, 503);
  assert.equal((await app.request("/api/auth/supabase/exchange", { method: "POST" })).status, 401);
  const sign = (changes = {}) => signedToken(pair, changes);
  const token = await sign();
  assert.equal((await app.request("/api/auth/supabase/exchange", { method: "GET", token })).status, 405);
  assert.equal((await app.request("/api/auth/supabase/exchange", { method: "POST", token,
    headers: { Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await app.request("/api/auth/supabase/exchange", { method: "POST", token,
    headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  const exchange = await app.request("/api/auth/supabase/exchange", { method: "POST", token });
  assert.equal(exchange.status, 200);
  const cookie = sessionCookie(exchange);
  assert(cookie);
  assert.match(exchange.headers.get("set-cookie"), /Max-Age=900; HttpOnly; SameSite=Lax/);
  const signedIn = await exchange.json();
  assert.equal(signedIn.user.name, "Creator");
  assert.match(signedIn.user.id, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual((await (await app.request("/api/auth/session", { cookie })).json()).user, signedIn.user);

  const stored = await readFile(join(directory, "auth-accounts.json"), "utf8");
  assert(!stored.includes("11111111-1111-4111-8111-111111111111"));
  assert(!stored.includes(token));
  assert(!stored.includes(cookie.split("=", 2)[1]));
  assert.equal((await stat(join(directory, "auth-accounts.json"))).mode & 0o077, 0);
  const repeated = await app.request("/api/auth/supabase/exchange", { method: "POST", token });
  assert.equal((await repeated.json()).user.id, signedIn.user.id);
  await app.close();
  app = null;
  const googleCookie = (await (await createLocalAuthStore(directory)).startSession({
    sub: "11111111-1111-4111-8111-111111111111", name: "Creator",
  })).split(";", 1)[0];
  app = await beta(directory, options);
  const googleUser = (await (await app.request("/api/auth/session", { cookie: googleCookie })).json()).user;
  assert.notEqual(googleUser.id, signedIn.user.id);
  assert.deepEqual((await (await app.request("/api/auth/session", { cookie })).json()).user, signedIn.user);
  assert.equal((await app.request("/api/auth/logout", { method: "POST", cookie })).status, 200);
  assert.equal((await (await app.request("/api/auth/session", { cookie })).json()).user, null);

  for (const invalid of [
    await sign({ issuer: "https://another.supabase.co/auth/v1" }),
    await sign({ audience: "other" }),
    await sign({ anonymous: true }),
    await sign({ role: "service_role" }),
    await sign({ expiresAt: 1 }),
    token.replace(/\.([A-Za-z0-9_-])([^.]*)$/, (_, first, rest) => `.${first === "A" ? "B" : "A"}${rest}`),
  ]) {
    const rejected = await app.request("/api/auth/supabase/exchange", { method: "POST", token: invalid });
    assert.equal(rejected.status, 401);
    assert.equal(sessionCookie(rejected), undefined);
  }
});

test("loopback beta accepts only a private Supabase project configuration", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-supabase-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "supabase.json");
  await writeFile(path, JSON.stringify({ publishableKey: PUBLISHABLE_KEY, url: PROJECT_URL }), { mode: 0o644 });
  await assert.rejects(beta(directory), /mode-0600/);
  await rm(path);
  await writeFile(path, JSON.stringify({ publishableKey: "pk_live_wrong", url: PROJECT_URL }), { mode: 0o600 });
  await assert.rejects(beta(directory), /publishable key/);
  await rm(path);
  await writeFile(path, JSON.stringify({ publishableKey: PUBLISHABLE_KEY, url: PROJECT_URL }), { mode: 0o600 });
  const app = await beta(directory);
  t.after(() => app.close());
  const status = await (await app.request("/api/auth/session")).json();
  assert.equal(status.supabasePublishableKey, PUBLISHABLE_KEY);
});
