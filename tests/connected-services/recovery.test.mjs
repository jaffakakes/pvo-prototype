import test from "node:test";
import assert from "node:assert/strict";
import { executeHostedConnections } from "../../server/cloud-services/accountExecution.js";
import { connectedAgreement, connectedSource, now } from "./fixtures.mjs";

test("a retry cannot commit a canned success while its prior provider request is unresolved", async () => {
  const agreement = connectedAgreement();
  const action = {
    actionId: "same",
    operation: "lookup",
    input: { number: 7 },
  };
  const invocation = {
    operation: "lookup",
    input: action.input,
    state: null,
    now,
  };
  let pending = {
    action,
    invocation,
    trace: [
      {
        request: { connection: "issue", input: action.input },
        result: null,
        status: "pending",
      },
    ],
    status: "needs_checking",
    writeStarted: true,
  };
  const host = {
    accounts: {
      requireApproval() {},
      begin: () => pending,
      pending: () => pending,
      save(_namespace, value) {
        pending = value;
      },
    },
    executePackage: async () => ({ result: "Fabricated success", state: null }),
  };
  await assert.rejects(
    executeHostedConnections(host, {
      publication: {
        identity: { resourceId: "release-one" },
        artifact: { agreement, package: connectedSource() },
      },
      action,
      digest: "digest",
      snapshot: { version: 0 },
      invocation,
      namespace: "live",
      signal: new AbortController().signal,
    }),
    (error) => error.code === "needs_checking",
  );
  assert.equal(pending.trace[0].status, "pending");
});
