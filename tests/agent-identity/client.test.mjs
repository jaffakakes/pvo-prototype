import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    export * from "./editor/src/infrastructure/connections/agentIdentity.ts";
    export {setClerkFixture} from "./tests/agent-identity/clerk.fixture.mjs";
  `,
  },
  plugins: [
    {
      name: "controlled-clerk",
      setup(build) {
        build.onResolve({ filter: /^\.\/clerk$/ }, (args) =>
          args.importer.endsWith("/auth/accountSessionToken.ts")
            ? { path: resolve("tests/agent-identity/clerk.fixture.mjs") }
            : undefined,
        );
      },
    },
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const client = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const signedIn = (id = "owner-one") => ({
  available: true,
  user: { id, name: "Creator" },
  clerkAvailable: true,
  clerkPublishableKey: "pk_test_fixture",
  canLinkEmail: false,
  emailLinked: true,
});
const approval = { consent: true, monthlyNumberCents: 0 };

test("identity enable uses fresh private session proof and sends no typed email or name", async (t) => {
  const calls = [];
  client.setClerkFixture(async () => ({
    session: {
      getToken: async (options) => {
        assert.deepEqual(options, { skipCache: true });
        return "synthetic.private.session";
      },
    },
  }));
  t.after(() => client.setClerkFixture(null));
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/auth/session") return Response.json(signedIn());
    assert.equal(url, "/api/agent-identity/start");
    assert.equal(
      options.headers.Authorization,
      "Bearer synthetic.private.session",
    );
    assert.deepEqual(JSON.parse(options.body), {
      provider: "agentmail",
      expectedRevision: 0,
      ...approval,
    });
    return Response.json({
      provider: "agentmail",
      revision: 1,
      status: "awaiting_verification",
      address: null,
      resourceId: null,
      connectionId: null,
      updatedAt: 1,
      issue: null,
      approval: { kind: "create", at: 1, monthlyNumberCents: 0 },
    });
  });
  await client.changeAgentIdentity(
    "owner-one",
    "start",
    "agentmail",
    0,
    approval,
    new AbortController().signal,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].options.body.includes("synthetic.private.session"),
    false,
  );
});

test("account changes and aborted sign-in loads cannot dispatch identity setup", async (t) => {
  let entered;
  const loading = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const requests = [];
  let tokenReads = 0;
  client.setClerkFixture(async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  t.after(() => client.setClerkFixture(null));
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return Response.json(signedIn("someone-else"));
  });
  await assert.rejects(
    client.changeAgentIdentity(
      "owner-one",
      "start",
      "agentmail",
      0,
      approval,
      new AbortController().signal,
    ),
    /account changed/,
  );
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return Response.json(signedIn());
  });
  const lifetime = new AbortController();
  const pending = client.changeAgentIdentity(
    "owner-one",
    "start",
    "agentmail",
    0,
    approval,
    lifetime.signal,
  );
  await loading;
  lifetime.abort();
  await assert.rejects(pending, /Account check stopped/);
  release({
    session: {
      getToken() {
        tokenReads++;
        return "late.private.session";
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ["/api/auth/session", "/api/auth/session"]);
  assert.equal(tokenReads, 0);
});
test("private identity transport binds the displayed owner, cancels with its lifetime and discards private errors", async (t) => {
  const lifetime = new AbortController();
  let received;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    received = options;
    assert.equal(url, "/api/agent-identity/discover");
    assert.equal(options.headers["X-Restyle-Owner"], "owner-one");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    return Response.json({
      resources: [{ resourceId: "inbox-one", address: "agent@example.com" }],
      more: false,
    });
  });
  const found = await client.discoverAgentIdentity(
    "owner-one",
    "agentmail",
    0,
    "synthetic_private_key_123456",
    lifetime.signal,
  );
  assert.equal(found.resources[0].address, "agent@example.com");
  lifetime.abort();
  assert.equal(received.signal.aborted, true);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "private-key-and-code" }, { status: 403 }),
  );
  await assert.rejects(
    client.listAgentIdentity("owner-one", new AbortController().signal),
    (error) =>
      error.message.includes("account changed") &&
      !error.message.includes("private-key-and-code"),
  );
});
