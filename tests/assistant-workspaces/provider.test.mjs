import assert from "node:assert/strict";
import test from "node:test";
import { workspaceProvider } from "../../server/assistant/tasks/workspaceProvider.js";
import {
  parseWorkspaceObservation,
  parseWorkspaceReceipt,
  serializeWorkspaceRequest,
} from "../../packages/pvo-assistant/workspaces/index.js";
import { contentDigest } from "../../server/contentDigest.js";
import {
  identity,
  files,
  executionGrant,
  workspaceFixture,
} from "./helpers.mjs";

const ok = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.result;
};

test("the workspace adapter consumes real Cloudflare RPC data and validates owned source and receipts", async () => {
  const f = await workspaceFixture();
  const who = await identity();
  const call = (method, input) =>
    f.call(method, who, input, { viaProvider: true });
  try {
    const receipt = ok(
      await call("save", { id: "save", expectedRevision: 0, files: files() }),
    );
    assert.equal(receipt.status, "completed");
    assert.deepEqual(ok(await call("receipt", "save")), receipt);
    assert.equal(ok(await call("receipt", "missing")), null);
    assert.deepEqual(ok(await call("lookup")).source.files, files());
    assert.equal(
      ok(await call("start", { id: "start", ...receipt.result })).status,
      "completed",
    );
    assert.equal(ok(await call("suspend", 1)).lease, null);
    assert.equal(ok(await call("stop")).closed, true);
  } finally {
    await f.close();
  }
});

test("invalid or mismatched provider receipts fail and all RPC results release their disposal capability", async () => {
  const who = await identity();
  const request = { id: "save", expectedRevision: 0, files: files() };
  const expected = {
    id: "save",
    kind: "save",
    digest: await contentDigest(serializeWorkspaceRequest("save", request)),
    status: "completed",
    result: { revision: 1, digest: "a".repeat(64) },
  };
  let disposed = 0;
  let output = expected;
  const provider = workspaceProvider({
    ASSISTANT_WORKSPACES: {
      getByName(resourceId) {
        assert.equal(resourceId, who.resourceId);
        return {
          save: async () => ({ ...output, [Symbol.dispose]: () => disposed++ }),
        };
      },
    },
    WORKSPACE_BUDGET: { getByName() {} },
  });
  assert.equal(workspaceProvider({}), null);
  assert.equal(
    workspaceProvider({ ASSISTANT_WORKSPACES: { getByName() {} } }),
    null,
  );
  assert.deepEqual(
    await provider.operate(who, "save", request, executionGrant()),
    expected,
  );
  output = { ...expected, id: "different" };
  await assert.rejects(
    provider.operate(who, "save", request, executionGrant()),
    /match/,
  );
  output = { ...expected, digest: "b".repeat(64) };
  await assert.rejects(
    provider.operate(who, "save", request, executionGrant()),
    /match/,
  );
  output = { ...expected, ready: true };
  await assert.rejects(
    provider.operate(who, "save", request, executionGrant()),
    /unsupported/,
  );
  assert.equal(disposed, 4);
});

test("workspace results reject readiness claims, excessive output, malformed success and foreign ownership", async () => {
  const command = {
    id: "test",
    kind: "command",
    digest: "a".repeat(64),
    status: "completed",
    result: { stdout: "", stderr: "", exitCode: 7 },
  };
  assert.equal(parseWorkspaceReceipt(command).result.exitCode, 7);
  for (const change of [
    (x) => (x.result.ready = true),
    (x) => (x.result.exitCode = "0"),
    (x) => (x.result.stdout = "é".repeat(8193)),
    (x) => (x.result.stderr = null),
    (x) => (x.status = "passed"),
    (x) => (x.result = { testsPassed: true }),
  ]) {
    const value = structuredClone(command);
    change(value);
    assert.throws(() => parseWorkspaceReceipt(value));
  }
  const who = await identity();
  const observation = {
    identity: who,
    closed: false,
    cleanupRequired: false,
    cleanupAttempts: 0,
    active: null,
    grant: null,
    revokedThrough: 0,
    lease: null,
    source: null,
  };
  assert.deepEqual(parseWorkspaceObservation(observation, who), observation);
  assert.throws(
    () => parseWorkspaceObservation(observation, { ...who, taskId: "foreign" }),
    /different task/,
  );
});
