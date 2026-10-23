import test from "node:test";
import assert from "node:assert/strict";
import {
  createServiceSubmissionClient,
  prepareServiceSubmission,
  completeServiceSubmission,
  serviceReceiptLink,
  parseReceiptLink,
  submissionFinished,
  watchServiceReceipt,
} from "../../packages/pvo-assistant/attachments/index.js";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
const target = {
  origin: "https://services.example",
  serviceId: "service-" + "a".repeat(64),
  releaseId: "release-" + "b".repeat(64),
  operation: { ...dinnerAgreement().operations[0], delivery: "background" },
  mode: "public",
  ownerId: null,
};
const context = { isCurrent: () => true };
const reply = (status, updatedAt = 1, result = null) => ({
  actionId: "action-one",
  job: {
    status,
    label: status,
    result,
    updatedAt,
    expiresAt: null,
    nextCheckAt: ["received", "pending"].includes(status)
      ? updatedAt + 5000
      : null,
  },
});
function storage() {
  let saved = null;
  return {
    read: async () => structuredClone(saved),
    update: async (slot, change) => {
      saved = change(structuredClone(saved));
      return structuredClone(saved);
    },
  };
}

test("background intent and secret commit before sending; pending and unknown retries only read the original receipt", async () => {
  const store = storage(),
    calls = [];
  let state = "received";
  const client = createServiceSubmissionClient({
    store,
    createId: () => "action-one",
    createReceiptKey: () => "e".repeat(64),
    send: async (wire) => {
      const saved = await store.read();
      assert.equal(saved.receiptKey, "e".repeat(64));
      calls.push(wire);
      return reply(state, calls.length);
    },
  });
  const accepted = await client.submit(
    "slot",
    target,
    { name: "Alice" },
    context,
  );
  assert.equal(submissionFinished(accepted), false);
  await assert.rejects(
    client.submit("slot", target, { name: "Bob" }, context),
    { code: "submission_pending" },
  );
  state = "pending";
  await client.retry("slot", target, context);
  state = "needs_checking";
  await client.retry("slot", target, context);
  assert.equal(calls.filter((wire) => wire.url.endsWith("/jobs")).length, 1);
  for (const wire of calls.slice(1)) {
    assert.ok(wire.url.endsWith("/job-receipt"));
    assert.deepEqual(JSON.parse(wire.body), {
      actionId: "action-one",
      receiptKey: "e".repeat(64),
    });
  }
  const link = serviceReceiptLink(await store.read());
  assert.equal(new URL(link).search, "");
  assert.ok(!new URL(link).pathname.includes("eeee"));
  assert.deepEqual(
    parseReceiptLink(
      JSON.parse(decodeURIComponent(new URL(link).hash.slice(1))),
    ),
    {
      serviceId: target.serviceId,
      actionId: "action-one",
      receiptKey: "e".repeat(64),
    },
  );
});

test("lost acceptance can be checked without creating work; stale status cannot overwrite completion and Try keeps the same envelope offline", async () => {
  const store = storage();
  let sends = 0;
  const client = createServiceSubmissionClient({
    store,
    createId: () => "action-one",
    createReceiptKey: () => "e".repeat(64),
    send: async (wire) => {
      sends++;
      if (wire.url.endsWith("/jobs")) throw new Error("lost acceptance");
      return reply("confirmed", 3, "accepted");
    },
  });
  await assert.rejects(
    client.submit("slot", target, { name: "Alice" }, context),
    /lost acceptance/,
  );
  const done = await client.check("slot", target, context, "action-one");
  assert.equal(submissionFinished(done), true);
  assert.equal(sends, 2);
  assert.throws(
    () => completeServiceSubmission(done, reply("pending", 2)),
    /older/,
  );
  await assert.rejects(
    client.check("slot", target, context, "other-action"),
    /newer/,
  );
  const trial = createServiceSubmissionClient({
    store: storage(),
    createId: () => "action-one",
    send: async (wire) => {
      assert.ok(wire.url.endsWith("/try"));
      return { actionId: "action-one", result: "accepted" };
    },
  });
  const checked = await trial.submit(
    "trial",
    { ...target, mode: "try", ownerId: "owner-one" },
    { name: "Alice" },
    context,
  );
  assert.equal(checked.receiptKey, undefined);
  assert.equal(checked.response.job.status, "confirmed");
  assert.match(checked.response.job.label, /no live message/);
});

test("receipt watcher bounds sequential checks and releases timers and in-flight reads when the view disappears", async () => {
  const timers = [],
    cancelled = [];
  let checks = 0,
    values = 0,
    lastSignal;
  const watcher = watchServiceReceipt({
    read: async () => ({
      background: true,
      complete: false,
      actionId: "action-one",
      receipt: reply("pending"),
    }),
    check: async (signal) => {
      checks++;
      lastSignal = signal;
      return { background: true, complete: false, receipt: reply("pending") };
    },
    onValue: () => values++,
    isCurrent: () => true,
    maxChecks: 2,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: (id) => cancelled.push(id),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  timers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 2);
  assert.equal(timers.length, 1);
  await watcher.refresh();
  assert.equal(checks, 2);
  assert.equal(values, 3);
  watcher.dispose();
  assert.equal(lastSignal.aborted, true);
  await watcher.refresh();
  assert.equal(values, 3);
  let resolve;
  const gate = new Promise((done) => {
    resolve = done;
  });
  let late = 0;
  const pending = watchServiceReceipt({
    read: () => gate,
    check: async () => {
      throw new Error("must not check");
    },
    onValue: () => late++,
    isCurrent: () => true,
  });
  pending.dispose();
  resolve({ background: true, complete: false });
  await new Promise((done) => setImmediate(done));
  assert.equal(late, 0);
});
