import assert from "node:assert/strict";
import test from "node:test";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import {
  create,
  claim,
  command,
  operation,
  result,
  question,
} from "./fixtures.mjs";

function record(task, receipt) {
  return command(task, { kind: "record_operation", operation: receipt });
}
function settle(task, changes = {}) {
  return record(task, {
    ...task.operations.at(-1),
    status: "completed",
    updatedAt: task.updatedAt + 1,
    ...changes,
  });
}

test("an operation records intent first, settles once, and replays exactly without advancing the revision", () => {
  let task = claim(create());
  assert.throws(
    () => record(task, { ...operation(task), status: "completed" }),
    /planned intent/,
  );
  task = record(task, operation(task));
  task = settle(task, {
    resources: [{ kind: "workspace", id: "workspace-one" }],
    artifact: result().artifact,
  });
  assert.deepEqual(record(task, task.operations[0]), task);
  const completed = task;
  assert.throws(
    () => record(task, { ...task.operations[0], inputDigest: "b".repeat(64) }),
    /conflicts/,
  );
  assert.throws(
    () =>
      record(task, {
        ...task.operations[0],
        resources: [],
        updatedAt: task.updatedAt + 1,
      }),
    /immutable/,
  );
  assert.deepEqual(task, completed);
});

test("uncertain effects prevent advancing, completing, or making a second fresh intent", () => {
  let task = claim(create());
  task = record(task, operation(task));
  task = settle(task, {
    status: "unknown",
    resources: [{ kind: "workspace", id: "maybe-created" }],
  });
  assert.throws(
    () => command(task, { kind: "checkpoint", stepId: "deploy" }),
    /Reconcile/,
  );
  assert.throws(
    () => command(task, { kind: "ask", question: question() }),
    /reconciled/,
  );
  assert.throws(
    () => command(task, { kind: "complete", result: result() }),
    /reconciled/,
  );
  assert.throws(
    () => record(task, { ...operation(task), id: "second-build" }),
    /Reconcile/,
  );
  assert.throws(() => settle(task, { status: "planned" }), /new attempt/);
  assert.throws(() => settle(task, { resources: [] }), /discarded/);
  task = settle(task);
  assert.equal(
    command(task, { kind: "checkpoint", stepId: "deploy" }).state,
    "queued",
  );
});

test("expired claims preserve uncertain resource references and reservations for reconciliation", () => {
  let task = claim(create());
  task = command(task, { kind: "reserve_usage", modelTurns: 0, toolCalls: 1 });
  task = record(task, operation(task));
  const expiry = task.claim.expiresAt;
  task = command(task, { kind: "recover" }, { now: expiry, claim: null });
  assert.equal(task.operations[0].status, "unknown");
  assert.equal(task.usage.reservedToolCalls, 1);
  const restored = claim(JSON.parse(JSON.stringify(task)));
  assert.throws(
    () => record(restored, { ...operation(restored), id: "new-attempt" }),
    /Reconcile/,
  );
  task = settle(restored, {
    resources: [{ kind: "workspace", id: "recovered-workspace" }],
  });
  task = command(task, {
    kind: "settle_usage",
    modelTurns: 0,
    toolCalls: 1,
    consumed: true,
  });
  assert.equal(
    command(task, { kind: "complete", result: result() }).state,
    "ready",
  );
});

test("confirmed absence is immutable evidence and a retry needs a distinct recorded identity", () => {
  let task = claim(create());
  task = record(task, operation(task));
  task = settle(task, { status: "absent" });
  assert.throws(() => settle(task, { status: "planned" }), /immutable/);
  task = record(task, { ...operation(task), id: "build-retry-one" });
  assert.equal(task.operations.length, 2);
  assert.equal(task.operations[0].status, "absent");
});

test("coordinator reconciliation preserves a queued task's already due wakeup", () => {
  let task = claim(create());
  task = record(task, operation(task));
  task = command(
    task,
    { kind: "recover" },
    {
      now: task.claim.expiresAt,
      claim: null,
    },
  );
  const wakeup = task.nextRunAt;
  task = command(task, {
    kind: "reconcile_operation",
    operation: {
      ...task.operations[0],
      status: "completed",
      updatedAt: task.updatedAt + 1,
    },
  });
  assert.equal(task.state, "queued");
  assert.equal(task.nextRunAt, wakeup);
  assert.ok(task.nextRunAt < task.updatedAt);
  assert.equal(
    command(claim(task), { kind: "complete", result: result() }).state,
    "ready",
  );
});

test("receipt time, step, duplicate IDs, failure classifications, and resource fields are checked", () => {
  let task = claim(create());
  assert.throws(
    () => record(task, { ...operation(task), stepId: "other-step" }),
    /different step/,
  );
  assert.throws(
    () => record(task, { ...operation(task), id: task.input.operationId }),
    /identities/,
  );
  assert.throws(
    () => record(task, { ...operation(task), updatedAt: task.updatedAt }),
    /reversed|command time/,
  );
  task = record(task, operation(task));
  assert.throws(() => settle(task, { status: "failed" }), /failure/);
  assert.throws(
    () =>
      settle(task, {
        resources: [{ kind: "workspace", id: "safe-id", token: "private" }],
      }),
    /unsupported fields/,
  );
  task = settle(task, {
    status: "failed",
    failure: { code: "execution_failed", stepId: "plan" },
  });
  assert.equal(task.operations[0].status, "failed");
});

test("operation history cannot silently evict old duplicate-prevention receipts", () => {
  let task = claim(create());
  for (let index = 0; index < TASK_LIMITS.operations; index++) {
    task = record(task, { ...operation(task), id: `op-${index}` });
    task = settle(task);
  }
  assert.throws(
    () => record(task, { ...operation(task), id: "one-too-many" }),
    /history is full/,
  );
  assert.equal(task.operations[0].id, "op-0");
  assert.equal(task.operations.length, 64);
});

test("trusted reconciliation can finish a cancelled receipt without restarting work or accepting a stale worker", () => {
  let task = claim(create());
  task = record(task, operation(task));
  const oldClaim = { id: task.claim.id, generation: task.generation };
  task = command(task, { kind: "stop" }, { claim: null });
  assert.equal(task.operations[0].status, "unknown");
  const receipt = {
    ...task.operations[0],
    status: "completed",
    resources: [{ kind: "workspace", id: "found-after-stop" }],
    updatedAt: task.updatedAt + 1,
  };
  assert.throws(
    () =>
      command(
        task,
        { kind: "record_operation", operation: receipt },
        { claim: oldClaim },
      ),
    /stale/,
  );
  task = command(task, { kind: "reconcile_operation", operation: receipt });
  assert.equal(task.state, "stopped");
  assert.equal(task.result, null);
  assert.equal(task.operations[0].resources[0].id, "found-after-stop");
  assert.throws(
    () =>
      command(task, {
        kind: "reconcile_operation",
        operation: { ...operation(task), id: "unrequested-create" },
      }),
    /cannot start/,
  );
});
