import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const url = "https://restyle-test.supabase.co";
const config = {
  available: true,
  supabaseAvailable: true,
  supabaseUrl: url,
  supabasePublishableKey: "sb_publishable_fixture",
};
const user = { id: "restyle-account", name: "Creator" };
const token = (sessionId = "session-a", subject = "user-a") =>
  `header.${Buffer.from(JSON.stringify({ iss: `${url}/auth/v1`, sub: subject, session_id: sessionId })).toString("base64url")}.signature`;
const bundled = await build({
  stdin: {
    contents: `
    export { exchangeSupabaseSession } from './editor/src/infrastructure/auth/client.ts';
    export { refreshAccountSession, signOutAccount, useAuthGate } from './editor/src/state/auth/authGateStore.ts';
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  plugins: [
    {
      name: "provider-session",
      setup(build) {
        build.onLoad({ filter: /[\\/]auth[\\/]supabase\.ts$/ }, () => ({
          contents: `
      export async function getSupabase() { return globalThis.sessionProvider; }
    `,
          loader: "ts",
        }));
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const values = new Map();
let providerSession, signedIn, calls, rejectExchange, pendingExchange;
test.beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  providerSession = { access_token: token() };
  signedIn = false;
  calls = [];
  rejectExchange = false;
  pendingExchange = null;
  globalThis.sessionProvider = {
    auth: {
      async getSession() {
        return { data: { session: providerSession }, error: null };
      },
    },
  };
  globalThis.fetch = async (path, init) => {
    calls.push(path);
    if (path === "/api/auth/supabase/exchange") {
      assert.equal(
        init.headers.Authorization,
        `Bearer ${providerSession.access_token}`,
      );
      if (pendingExchange) await pendingExchange;
      if (rejectExchange) return new Response(null, { status: 401 });
      signedIn = true;
      return Response.json({ user });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return Response.json({ user: null });
    }
    assert.equal(path, "/api/auth/session");
    return Response.json({ ...config, user: signedIn ? user : null });
  };
  api.useAuthGate.setState({ user: null, phase: "idle", source: null });
});
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.sessionProvider;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

async function acceptedThenExpired() {
  await api.exchangeSupabaseSession(providerSession.access_token);
  signedIn = false;
  calls.length = 0;
}

test("saved sign-in renews the expired cookie before exposing the account after reload", async () => {
  await acceptedThenExpired();
  assert.equal((await api.refreshAccountSession()).user.id, user.id);
  assert.deepEqual(calls, [
    "/api/auth/session",
    "/api/auth/supabase/exchange",
    "/api/auth/session",
  ]);
  assert(
    ![...values.values()].some((value) => value.includes("signature")),
    "the intent record stores no token",
  );
  calls.length = 0;
  await api.refreshAccountSession();
  assert.deepEqual(
    calls,
    ["/api/auth/session"],
    "a live cookie needs no exchange",
  );
});

test("an unaccepted provider session or different session cannot silently sign in", async () => {
  assert.equal((await api.refreshAccountSession()).user, null);
  await acceptedThenExpired();
  providerSession = { access_token: token("session-b") };
  assert.equal((await api.refreshAccountSession()).user, null);
  providerSession = { access_token: token("session-a", "user-b") };
  assert.equal((await api.refreshAccountSession()).user, null);
  assert(!calls.includes("/api/auth/supabase/exchange"));
});

test("missing provider credentials and rejected renewal never authenticate locally", async () => {
  await acceptedThenExpired();
  providerSession = null;
  assert.equal((await api.refreshAccountSession()).user, null);
  providerSession = { access_token: token() };
  rejectExchange = true;
  await assert.rejects(api.refreshAccountSession(), /Couldn't finish sign-in/);
  assert.equal(api.useAuthGate.getState().user, null);
  rejectExchange = false;
  assert.equal(
    (await api.refreshAccountSession()).user.id,
    user.id,
    "a retry can recover without losing the saved sign-in",
  );
});

test("sign-out clears remembered intent and wins against a renewal already in flight", async (t) => {
  await acceptedThenExpired();
  let finishExchange;
  pendingExchange = new Promise((resolve) => {
    finishExchange = resolve;
  });
  const restoring = api.refreshAccountSession();
  t.after(async () => {
    finishExchange();
    await restoring;
  });
  const deadline = Date.now() + 1000;
  while (!calls.includes("/api/auth/supabase/exchange")) {
    assert(Date.now() < deadline, "The pending session renewal did not start.");
    await new Promise((resolve) => setImmediate(resolve));
  }
  const signingOut = api.signOutAccount();
  finishExchange();
  await Promise.all([restoring, signingOut]);
  assert.equal(signedIn, false);
  assert.equal(api.useAuthGate.getState().user, null);
  assert.equal(values.size, 0);
  calls.length = 0;
  assert.equal((await api.refreshAccountSession()).user, null);
  assert(
    !calls.includes("/api/auth/supabase/exchange"),
    "remaining provider credentials cannot undo explicit sign-out",
  );
});
