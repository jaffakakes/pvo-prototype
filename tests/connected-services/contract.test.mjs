import test from "node:test";
import assert from "node:assert/strict";
import {
  parseConnectionAdapter,
  projectAdapterResult,
} from "../../packages/pvo-assistant/connections/index.js";
import {
  parseServiceAgreement,
  parseAccountRequest,
} from "../../packages/pvo-assistant/services/index.js";
import { executeConnectedOperation } from "../../server/cloud-services/connectedExecution.js";
import {
  connectedAgreement,
  readAdapter,
  writeAdapter,
  now,
} from "./fixtures.mjs";

test("generated adapters admit scoped synchronous recipes and reject extra authority", () => {
  assert.equal(parseConnectionAdapter(readAdapter()).name, "readIssue");
  assert.equal(
    parseConnectionAdapter(writeAdapter()).permission,
    "issues:write",
  );
  for (const change of [
    { origin: "https://evil.example" },
    { headers: { Authorization: "secret" } },
    { method: "DELETE" },
    { path: [".."] },
    { path: ["actions"] },
    { provider: "unknown" },
    { completion: "callback" },
    { permission: "issues:write" },
    { query: [{ name: "token", value: "key" }] },
    { responsePath: ["__proto__"] },
    { path: ["issues", { input: "missing" }] },
  ])
    assert.throws(() =>
      parseConnectionAdapter({ ...readAdapter(), ...change }),
    );
  const projected = projectAdapterResult(readAdapter(), {
    title: "Visible",
    body: "Private surplus",
    token: "not returned",
  });
  assert.deepEqual(projected, { title: "Visible" });
  assert.throws(() => projectAdapterResult(readAdapter(), { title: 42 }));
});

test("agreement binds request names and examples to explicit service operations", () => {
  const agreement = parseServiceAgreement(connectedAgreement());
  assert.deepEqual(
    parseAccountRequest(agreement, "lookup", {
      connection: "issue",
      input: { number: 7 },
    }),
    { connection: "issue", input: { number: 7 } },
  );
  assert.throws(() =>
    parseAccountRequest(agreement, "other", {
      connection: "issue",
      input: { number: 7 },
    }),
  );
  const duplicate = connectedAgreement();
  duplicate.connections.push(duplicate.connections[0]);
  assert.throws(() => parseServiceAgreement(duplicate));
  const longRunning = connectedAgreement();
  longRunning.connections[0].adapter.completion = "poll";
  assert.throws(() => parseServiceAgreement(longRunning));
});

test("Try consumes exact independent examples; live execution only receives projected results", async () => {
  const agreement = connectedAgreement();
  const invocation = {
    operation: "lookup",
    input: { number: 7 },
    state: null,
    now,
  };
  const inputs = [];
  const execute = async (input) => {
    inputs.push(structuredClone(input));
    return input.connectionResults
      ? { result: input.connectionResults[0].result.title, state: null }
      : { request: { connection: "issue", input: input.input } };
  };
  assert.deepEqual(
    await executeConnectedOperation({ agreement, invocation, execute }),
    { result: "Saved example", state: null },
  );
  assert.equal(inputs.length, 2);
  assert.equal(JSON.stringify(inputs).includes("connection-one"), false);
  await assert.rejects(
    executeConnectedOperation({
      agreement,
      invocation: { ...invocation, input: { number: 8 } },
      execute,
    }),
    /no independently saved/,
  );
  let calls = 0;
  const reply = await executeConnectedOperation({
    agreement,
    invocation,
    execute,
    invoke: async (request, index) => {
      calls++;
      assert.equal(index, 0);
      assert.equal(request.connection, "issue");
      return { title: "Actual provider" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(reply.result, "Actual provider");
  await assert.rejects(
    executeConnectedOperation({
      agreement,
      invocation,
      execute,
      invoke: async () => ({ title: 4 }),
    }),
  );
  await assert.rejects(
    executeConnectedOperation({
      agreement,
      invocation,
      execute: async () => ({
        request: { connection: "issue", input: { number: 7 } },
      }),
    }),
    /capacity/,
  );
});
