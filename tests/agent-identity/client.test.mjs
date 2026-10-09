import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  entryPoints: ["editor/src/infrastructure/connections/agentIdentity.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const client = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

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
