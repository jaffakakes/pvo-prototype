import test from "node:test";
import assert from "node:assert/strict";
import { flyMachineApi } from "../../server/cloud-services/node/fly/api.js";

test("the product Fly adapter can reach only Machine operations inside its configured app", async () => {
  const calls = [];
  const request = flyMachineApi({
    app: "restyle-owned",
    token: "private-test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ id: "1234567890abcd" });
    },
  });
  const root = "/apps/restyle-owned/machines";
  for (const [method, path] of [
    ["GET", root],
    ["POST", root],
    ["GET", root + "/1234567890abcd"],
    ["POST", root + "/1234567890abcd/start"],
    ["POST", root + "/1234567890abcd/exec"],
    ["DELETE", root + "/1234567890abcd?force=true"],
  ])
    assert.equal((await request(method, path)).ok, true);
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every(
      (call) =>
        call.url.startsWith(
          "https://api.machines.dev/v1/apps/restyle-owned/machines",
        ) && call.options.redirect === "error",
    ),
  );
  for (const [method, path] of [
    ["GET", "/apps/foreign/machines"],
    ["DELETE", "/apps/restyle-owned"],
    ["POST", root + "/1234567890abcd/../exec"],
    ["POST", "https://untrusted.invalid/"],
    ["DELETE", root],
    ["GET", root + "?token=private"],
  ])
    await assert.rejects(request(method, path), { code: "invalid_input" });
  assert.equal(calls.length, 6);
});

test("an unknown create outcome is never retried and aborted admission never sends credentials", async () => {
  let calls = 0;
  const request = flyMachineApi({
    app: "restyle-owned",
    token: "private-test-token",
    fetchImpl: async () => {
      calls++;
      throw new TypeError("controlled lost connection");
    },
  });
  await assert.rejects(
    request("POST", "/apps/restyle-owned/machines", {}),
    TypeError,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    request(
      "POST",
      "/apps/restyle-owned/machines",
      {},
      { signal: AbortSignal.abort() },
    ),
  );
  assert.equal(calls, 1);
});

test("provider replies are byte bounded and malformed or oversized replies cannot leak private bodies", async () => {
  for (const body of [
    "private invalid provider body",
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    const request = flyMachineApi({
      app: "restyle-owned",
      token: "private-test-token",
      fetchImpl: async () => new Response(body),
    });
    await assert.rejects(
      request("GET", "/apps/restyle-owned/machines"),
      (error) =>
        error.code === "runtime_unavailable" &&
        !error.message.includes("private"),
    );
  }
});
