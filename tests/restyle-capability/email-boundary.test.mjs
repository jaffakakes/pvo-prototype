import assert from "node:assert/strict";
import test from "node:test";
import { checkEmailReceiptBounds } from "../../scripts/checks/restyle-capability/email-boundary.mjs";
import {
  connectedAgreement,
  field,
  record,
  string,
} from "../connected-services/fixtures.mjs";

function emailAgreement() {
  const agreement = connectedAgreement();
  const input = { subject: "Thanks", text: "Thanks for watching" };
  const binding = agreement.connections[0];
  binding.name = "emailSender";
  binding.adapter = {
    ...binding.adapter,
    name: "sendMail",
    provider: "agentmail",
    method: "POST",
    path: ["messages", "send"],
    input: record(field("subject", string(256)), field("text", string(4096))),
    result: record(field("id", string(512))),
    permission: "email:send",
    documentation:
      "https://docs.agentmail.to/api-reference/inboxes/messages/send",
  };
  binding.examples = [{ input, result: { id: "short" } }];
  const operation = agreement.operations[0];
  operation.access = "write";
  operation.input = { type: "null" };
  operation.result = record(
    field("status", string(512)),
    field("id", string(512)),
  );
  const step = agreement.cases[0].steps[0];
  step.input = null;
  step.requests = [{ connection: binding.name, input }];
  step.expected.result = { status: "Accepted", id: "short" };
  return agreement;
}

function execute(status, transform = (id) => id) {
  return async ({ state, connectionResults = [] }) => {
    if (!connectionResults.length)
      return {
        request: {
          connection: "emailSender",
          input: { subject: "Thanks", text: "Thanks for watching" },
        },
      };
    const id = connectionResults[0].result.id;
    return { result: { status: status(id), id: transform(id) }, state };
  };
}

test("email boundary accepts unchanged maximum ASCII and Unicode receipts", async () => {
  const results = [];
  await checkEmailReceiptBounds(
    emailAgreement(),
    execute(() => "Accepted"),
    async (row) => results.push(row),
  );
  assert.deepEqual(results, [
    { receiptBytes: 512, unicode: false, requests: 1, passed: true },
    { receiptBytes: 512, unicode: true, requests: 1, passed: true },
  ]);
});

test("email boundary uses the declared empty-object operation input", async () => {
  const agreement = emailAgreement();
  agreement.operations[0].input = record();
  agreement.cases[0].steps[0].input = {};
  const results = [];
  const run = execute(() => "Accepted");
  await checkEmailReceiptBounds(
    agreement,
    async (invocation) => {
      assert.deepEqual(invocation.input, {});
      return run(invocation);
    },
    async (row) => results.push(row),
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((row) => row.passed && row.requests === 1));
});

test("email boundary rejects composed status overflow and truncated receipt IDs", async () => {
  for (const run of [
    execute((id) => "Accepted: " + id),
    execute(
      () => "Accepted",
      (id) => id.slice(0, 40),
    ),
  ]) {
    const results = [];
    await assert.rejects(
      checkEmailReceiptBounds(emailAgreement(), run, async (row) =>
        results.push(row),
      ),
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].passed, false);
    assert.equal(results[0].requests, 1);
  }
});
