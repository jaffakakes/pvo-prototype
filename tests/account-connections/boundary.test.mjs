import assert from "node:assert/strict";
import test from "node:test";
import { githubAdapter } from "../../server/connections/providers/github.js";
import {
  protectCredential,
  openCredential,
} from "../../server/connections/credentials.js";
import {
  parseBuilderDecision,
  builderDecisionSchema,
} from "../../packages/pvo-assistant/builder/index.js";
import { setup, TOKEN, KEY } from "./helpers.mjs";

test("credential envelopes reject a different owner, connection, revision or wrapping key", async () => {
  const env = { ACCOUNT_CONNECTION_KEY: KEY };
  const envelope = await protectCredential(env, "owner-one", "one", 1, TOKEN);
  assert.equal(
    await openCredential(env, "owner-one", "one", 1, envelope),
    TOKEN,
  );
  for (const [owner, id, revision, key] of [
    ["owner-two", "one", 1, KEY],
    ["owner-one", "two", 1, KEY],
    ["owner-one", "one", 2, KEY],
    ["owner-one", "one", 1, "b".repeat(64)],
  ])
    await assert.rejects(
      openCredential(
        { ACCOUNT_CONNECTION_KEY: key },
        owner,
        id,
        revision,
        envelope,
      ),
      /could not be unlocked/,
    );
});

test("provider redirects, oversized data, reflected secrets and rate limits cannot escape the boundary", async () => {
  const escaped = [...TOKEN]
    .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("");
  const cases = [
    new Response(null, {
      status: 302,
      headers: { location: "https://attacker.test" },
    }),
    new Response("x".repeat(256 * 1024 + 1)),
    new Response(
      `{"full_name":"${setup.repository}","private":true,"token":"${escaped}"}`,
    ),
    Response.json({ full_name: setup.repository, private: true, token: TOKEN }),
    Response.json(
      { error: TOKEN },
      { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    ),
  ];
  for (const response of cases) {
    let calls = 0;
    const adapter = githubAdapter(async (url, options) => {
      calls++;
      assert.equal(new URL(url).origin, "https://api.github.com");
      assert.equal(options.redirect, "manual");
      assert.equal(options.method, "GET");
      return response;
    });
    await assert.rejects(
      adapter.invoke(setup, TOKEN, {
        operation: "github_repository_read",
        input: {},
      }),
      (error) => !error.message.includes(TOKEN),
    );
    assert.equal(calls, 1);
  }
});

test("private setup is a declared capability, never an arbitrary credential-bearing model tool", () => {
  const decision = { kind: "connect_account", setup, purpose: "Read issues." };
  const stage = { hasAgreement: false, available: [] };
  assert.throws(() => parseBuilderDecision(decision, stage), /unavailable/);
  assert.deepEqual(
    parseBuilderDecision(decision, { ...stage, connectionSetup: true }),
    decision,
  );
  assert.throws(() =>
    parseBuilderDecision(
      { ...decision, token: TOKEN },
      { ...stage, connectionSetup: true },
    ),
  );
  assert.equal(
    JSON.stringify(builderDecisionSchema(false, [])).includes(
      "connect_account",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(builderDecisionSchema(false, [], true)).includes(
      "connect_account",
    ),
    true,
  );
});

test("provider deadline bounds an unresponsive fetch or response body", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const blocked = githubAdapter(() => new Promise(() => {}), 10);
    await assert.rejects(
      blocked.invoke(setup, TOKEN, {
        operation: "github_repository_read",
        input: {},
      }),
      /could not be reached/,
    );
    let cancelled = false;
    const stalled = githubAdapter(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      10,
    );
    await assert.rejects(
      stalled.invoke(setup, TOKEN, {
        operation: "github_repository_read",
        input: {},
      }),
      /could not safely read/,
    );
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(keepAlive);
  }
});
