import assert from "node:assert/strict";
import test from "node:test";
import { createAccountReader } from "../scripts/checks/cloud-agent-infrastructure/account.mjs";
import { checkInfrastructure } from "../scripts/checks/cloud-agent-infrastructure/preflight.mjs";
import worker from "../scripts/checks/cloud-agent-infrastructure/hosting-worker.js";

test("preflight is read-only and does not mistake unavailable access for a working runtime", async () => {
  const calls = [];
  const read = createAccountReader({
    accountId: "a".repeat(32),
    token: "private-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("workers/subdomain"))
        return Response.json({
          success: true,
          result: { subdomain: "proof-account" },
        });
      const code = url.endsWith("containers/applications") ? 1000 : 10121;
      return Response.json(
        { success: false, errors: [{ code, message: "private-token" }] },
        { status: 403 },
      );
    },
  });
  const report = await checkInfrastructure(read);
  assert.deepEqual(
    report.checks.map((check) => check.available),
    [true, false, false],
  );
  assert.equal(report.readyForOriginalProviderProof, false);
  assert.equal(report.liveWorkspaceProofPassed, false);
  assert.equal(report.workspaceIndependentHostingPassed, false);
  assert.equal(JSON.stringify(report).includes("private-token"), false);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      ({ options }) =>
        options.method === "GET" &&
        options.redirect === "error" &&
        options.signal,
    ),
  );
});

test("successful listings still do not count as a completed live proof", async () => {
  const report = await checkInfrastructure(async (path) => ({
    ok: true,
    status: 200,
    codes: [],
    result: path === "workers/subdomain" ? { subdomain: "test" } : [],
  }));
  assert.equal(report.readyForOriginalProviderProof, true);
  assert.equal(report.workspaceIndependentHostingPassed, false);
});

test("malformed responses and transport errors fail closed without disclosing error text", async () => {
  for (const fetchImpl of [
    async () => Response.json({ success: true, result: {} }),
    async () => new Response("not JSON"),
    async () => {
      throw new Error("private-token");
    },
  ]) {
    const read = createAccountReader({
      accountId: "a".repeat(32),
      token: "private-token",
      fetchImpl,
    });
    const report = await checkInfrastructure(read);
    assert.equal(report.readyForOriginalProviderProof, false);
    assert.equal(JSON.stringify(report).includes("private-token"), false);
  }
});

test("hosting fixture requires private access and expires; it exposes only the fixed proof", async () => {
  const env = {
    PROOF_TOKEN: "test-only-secret",
    PROOF_ID: "test-proof",
    PROOF_EXPIRES_AT: String(Date.now() + 60_000),
  };
  const request = (path = "/proof", options = {}) =>
    new Request(`https://proof.example${path}`, {
      headers: { Authorization: `Bearer ${env.PROOF_TOKEN}` },
      ...options,
    });
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal(
    (await worker.fetch(request(), { ...env, PROOF_EXPIRES_AT: "bad" })).status,
    503,
  );
  assert.equal(
    (await worker.fetch(request("/proof", { headers: {} }), env)).status,
    401,
  );
  assert.equal((await worker.fetch(request("/anything"), env)).status, 404);
  assert.equal(
    (
      await worker.fetch(
        request("/proof", { method: "POST", body: "arbitrary code" }),
        env,
      )
    ).status,
    405,
  );
  assert.equal(
    (await worker.fetch(request(), { ...env, PROOF_EXPIRES_AT: "1" })).status,
    410,
  );
  const response = await worker.fetch(request(), env);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    proofId: "test-proof",
    runtime: "cloudflare-worker",
    answer: 42,
  });
});
