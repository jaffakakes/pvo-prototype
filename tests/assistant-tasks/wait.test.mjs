import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskRecord } from "../../packages/pvo-assistant/tasks/index.js";
import { create, claim, command, operation } from "./fixtures.mjs";

test("capacity waits preserve the goal, fence old workers, and resume only when due", () => {
  const active = claim(create());
  const nextRunAt = active.updatedAt + 86400000;
  const waiting = command(active, {
    kind: "wait",
    reason: "model_allowance",
    nextRunAt,
  });
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.failure, null);
  assert.equal(waiting.expiresAt, null);
  assert.equal(waiting.claim, null);
  assert.deepEqual(waiting.input, active.input);
  assert.throws(() => claim(waiting), /cannot be claimed/);
  assert.throws(
    () =>
      command(
        waiting,
        { kind: "checkpoint", stepId: "build" },
        { claim: { id: active.claim.id, generation: active.generation } },
      ),
    /claim/,
  );
  const resumed = command(
    parseTaskRecord(JSON.parse(JSON.stringify(waiting))),
    { kind: "claim", claimId: "new-worker", leaseMs: 60000 },
    { now: nextRunAt },
  );
  assert.equal(resumed.id, active.id);
  assert.equal(resumed.stepId, active.stepId);
  assert.equal(resumed.wait, null);
  const stopped = command(waiting, { kind: "stop" });
  assert.equal(stopped.wait, null);
  assert.throws(
    () =>
      command(
        stopped,
        { kind: "claim", claimId: "late-worker", leaseMs: 60000 },
        { now: nextRunAt },
      ),
    /terminal/,
  );
});

test("permission waits have no automatic wakeup and cannot discard outstanding effects", () => {
  const active = claim(create());
  const wait = { kind: "wait", reason: "spending_permission", nextRunAt: null };
  const waiting = command(active, wait);
  assert.equal(waiting.nextRunAt, null);
  assert.throws(() => claim(waiting), /cannot be claimed/);
  const queued = command(waiting, { kind: "resume" });
  assert.equal(queued.state, "queued");
  assert.equal(queued.wait, null);
  const unknown = command(active, {
    kind: "record_operation",
    operation: operation(active),
  });
  assert.throws(() => command(unknown, wait), /unfinished operations/);
  const reserved = command(active, {
    kind: "reserve_usage",
    modelTurns: 1,
    toolCalls: 0,
  });
  assert.throws(() => command(reserved, wait), /settled/);
  assert.throws(
    () => command(active, { ...wait, nextRunAt: active.updatedAt + 1000 }),
    /explicit resumption/,
  );
  assert.throws(
    () => command(active, { ...wait, reason: "model_capacity" }),
    /explicit resumption/,
  );
  assert.throws(
    () => command(active, { ...wait, reason: "invented" }),
    /unsupported/,
  );
});
