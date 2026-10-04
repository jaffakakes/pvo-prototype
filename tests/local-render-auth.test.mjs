import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalAuthApi } from "../scripts/dev/local-auth.mjs";
import { createLocalAuthStore } from "../scripts/dev/local-auth-store.mjs";
import { createLocalSessions } from "../scripts/dev/local-sessions.mjs";
import { createLocalRenderApi } from "../scripts/dev/render-jobs.mjs";

function source() {
  return { ratio: "9:16", quality: "720p", muted: false, sound: 0,
    clips: [{ id: 1, url: "source_1", color: "#000000", srcDur: 1,
      in: 0, out: 1, speed: 1, zoom: 1, fit: "cover" }],
    audioClips: [], texts: [], components: [], layers: ["video"] };
}

async function beta(directory, configured = true) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/auth/")) await auth.handle(request, response, url.pathname);
      else if (url.pathname.startsWith("/api/renders"))
        await renders.handle(request, response, url.pathname, url.origin);
      else response.writeHead(404).end();
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = await createLocalAuthApi({ directory, origin,
    ...(configured ? { clientId: "test-client", clientSecret: "test-secret" } : {}) });
  const renders = await createLocalRenderApi({ userFor: auth.userFor });
  return {
    origin,
    request(path, { method = "GET", cookie, body, headers = {} } = {}) {
      return fetch(`${origin}${path}`, { method, body,
        headers: { ...(cookie ? { Cookie: cookie } : {}),
          ...(method === "GET" ? {} : { Origin: origin }), ...headers } });
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
      await renders.close();
    },
  };
}

test("local renders require the revocable Google account session for creation and job access", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-render-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createLocalAuthStore(directory);
  const ownerCookie = (await store.startSession({ sub: "google-owner", name: "Owner" })).split(";", 1)[0];
  const sameAccountCookie = (await store.startSession({ sub: "google-owner", name: "Owner" })).split(";", 1)[0];
  const otherAccountCookie = (await store.startSession({ sub: "google-other", name: "Other" })).split(";", 1)[0];
  const anonymous = await createLocalSessions({ directory });
  const anonymousCookie = anonymous.cookie(anonymous.ensure({ headers: {} }).token).split(";", 1)[0];
  const app = await beta(directory);
  t.after(() => app.close());

  const createOptions = { method: "POST", body: JSON.stringify({ source: source(),
    assets: [{ id: "source_1", bytes: 1, contentType: "video/mp4" }] }),
  headers: { "Content-Type": "application/json" } };
  const capability = await app.request("/api/renders");
  assert.equal(capability.status, 200);
  assert.equal((await capability.json()).available, true);
  for (const cookie of [undefined, anonymousCookie]) {
    const denied = await app.request("/api/renders", { ...createOptions, cookie });
    assert.equal(denied.status, 401);
    assert.match((await denied.json()).error, /sign in/i);
  }

  const created = await app.request("/api/renders", { ...createOptions, cookie: ownerCookie });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("set-cookie"), null);
  const { id } = await created.json();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal((await app.request(`/api/renders/${id}`, { cookie: sameAccountCookie })).status, 200);
  assert.equal((await app.request(`/api/renders/${id}`, { cookie: otherAccountCookie })).status, 404);
  assert.equal((await app.request(`/api/renders/${id}`, { method: "DELETE", cookie: otherAccountCookie })).status, 404);

  const paths = [
    [`/api/renders/${id}`, "GET"],
    [`/api/renders/${id}/sources/source_1`, "PUT"],
    [`/api/renders/${id}/start`, "POST"],
    [`/api/renders/${id}/result`, "GET"],
    [`/api/renders/${id}`, "DELETE"],
  ];
  for (const [path, method] of paths)
    assert.equal((await app.request(path, { method, cookie: anonymousCookie })).status, 401, `${method} ${path}`);

  const uploaded = await app.request(`/api/renders/${id}/sources/source_1`, {
    method: "PUT", cookie: ownerCookie, body: Buffer.from("x"),
  });
  assert.equal(uploaded.status, 200);
  assert.deepEqual(await uploaded.json(), { uploaded: true });
  assert.equal((await app.request(`/api/renders/${id}/result`, { cookie: ownerCookie })).status, 409);
  assert.equal((await app.request("/api/auth/logout", { method: "POST", cookie: ownerCookie })).status, 200);
  assert.equal((await app.request(`/api/renders/${id}`, { cookie: ownerCookie })).status, 401);
  assert.equal((await app.request("/api/renders", { ...createOptions, cookie: ownerCookie })).status, 401);
  assert.equal((await app.request(`/api/renders/${id}`, { method: "DELETE", cookie: sameAccountCookie })).status, 200);
  assert.equal((await app.request(`/api/renders/${id}`, { cookie: sameAccountCookie })).status, 404);
});

test("local renders stay signed out when Google sign-in is unavailable", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-render-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createLocalAuthStore(directory);
  const cookie = (await store.startSession({ sub: "google-owner", name: "Owner" })).split(";", 1)[0];
  const app = await beta(directory, false);
  t.after(() => app.close());
  assert.deepEqual(await (await app.request("/api/auth/session", { cookie })).json(),
    { available: false, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: null });
  assert.equal((await app.request("/api/renders", { method: "POST", cookie, body: "{}" })).status, 401);
});
