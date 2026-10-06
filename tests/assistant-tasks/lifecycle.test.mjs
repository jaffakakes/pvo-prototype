import assert from "node:assert/strict";
import test from "node:test";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";
import {
  create,
  hash,
  claim,
  command,
  question,
  answer,
  result,
} from "./fixtures.mjs";

test("a question survives a JSON round trip and resumes to a result with one revision per change", () => {
  const original = create();
  let task = claim(original);
  task = command(task, { kind: "ask", question: question() });
  assert.equal(task.state, "waiting_for_answer");
  assert.equal(task.claim, null);
  task = command(JSON.parse(JSON.stringify(task)), answer());
  assert.equal(task.state, "queued");
  assert.equal(task.questions[0].revision, 1);
  assert.deepEqual(
    command(task, answer()),
    task,
    "An identical answer replay changes nothing",
  );
  assert.throws(
    () => command(task, { ...answer(), value: "Saturday" }),
    /conflicts/,
  );
  assert.throws(
    () => command(task, { ...answer(), questionRevision: 1 }),
    /Question revision/,
  );
  task = claim(task);
  task = command(task, { kind: "complete", result: result() });
  assert.equal(task.state, "ready");
  assert.equal(task.revision, 5);
  assert.equal(original.revision, 0);
  for (const kind of ["resume", "stop", "recover"])
    assert.throws(() => command(task, { kind }), /terminal/);
});

test("wrong owners, stale revisions, old claims and clocks cannot mutate the task", () => {
  const queued = create();
  const running = claim(queued);
  const next = { kind: "checkpoint", stepId: "build" };
  assert.throws(
    () => command(running, next, { ownerId: "owner-two" }),
    /access denied/,
  );
  assert.throws(
    () => command(running, next, { expectedRevision: 0 }),
    /revision is stale/,
  );
  assert.throws(
    () => command(running, next, { now: queued.createdAt }),
    /time precedes/,
  );
  assert.throws(
    () =>
      command(running, next, {
        claim: { id: running.claim.id, generation: 0 },
      }),
    /claim.*stale/,
  );
  assert.throws(
    () =>
      command(running, next, {
        claim: { id: "someone-else", generation: running.generation },
      }),
    /claim.*stale/,
  );
  assert.throws(
    () => command(running, next, { now: running.claim.expiresAt }),
    /claim.*expired/,
  );
  assert.throws(
    () => command(queued, { kind: "complete", result: result() }),
    /claim/,
  );
  assert.equal(running.state, "running");
});

test("Stop invalidates late worker results while preserving questions and previously reserved usage", () => {
  let task = claim(create());
  task = command(task, { kind: "reserve_usage", modelTurns: 1, toolCalls: 0 });
  const oldClaim = { id: task.claim.id, generation: task.generation };
  const stopped = command(task, { kind: "stop" }, { claim: null });
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.usage.reservedModelTurns, 1);
  assert.ok(stopped.generation > oldClaim.generation);
  assert.throws(
    () =>
      command(
        stopped,
        { kind: "complete", result: result() },
        { claim: oldClaim },
      ),
    /claim|terminal/,
  );
  const waiting = command(claim(create()), {
    kind: "ask",
    question: question(),
  });
  assert.equal(command(waiting, { kind: "stop" }).questions[0].answer, null);
});

test("claim recovery is delayed until expiry, bounded, and cannot extend the task deadline", () => {
  let task = claim(create());
  assert.throws(
    () => command(task, { kind: "recover" }, { claim: null }),
    /expired/,
  );
  for (let index = 0; index < TASK_LIMITS.retries; index++) {
    const old = task;
    task = command(
      task,
      { kind: "recover" },
      { now: task.claim.expiresAt, claim: null },
    );
    assert.equal(task.state, "queued");
    task = claim(task);
    assert.throws(
      () =>
        command(
          task,
          { kind: "checkpoint", stepId: "build" },
          { claim: { id: old.claim.id, generation: old.generation } },
        ),
      /stale/,
    );
  }
  task = command(
    task,
    { kind: "recover" },
    { now: task.claim.expiresAt, claim: null },
  );
  assert.equal(task.state, "failed");
  assert.equal(task.failure.code, "budget_exceeded");
  const expired = claim(create());
  const failed = command(
    expired,
    { kind: "recover" },
    { now: expired.deadlineAt, claim: null },
  );
  assert.equal(failed.failure.code, "deadline_exceeded");
  assert.throws(() => command(failed, { kind: "resume" }), /deadline/);
  assert.equal(command(failed, { kind: "stop" }).state, "stopped");
});

test("failures have fixed classifications and only retryable failures can resume", () => {
  let task = claim(create());
  task = command(task, {
    kind: "fail",
    failure: { code: "provider_unavailable", stepId: "plan" },
  });
  task = command(task, { kind: "resume" });
  assert.equal(task.state, "queued");
  assert.equal(task.retries, 1);
  const failed = command(claim(create()), {
    kind: "fail",
    failure: { code: "invalid_result", stepId: "plan" },
  });
  assert.throws(() => command(failed, { kind: "resume" }), /cannot be resumed/);
  assert.throws(
    () =>
      command(claim(create()), {
        kind: "fail",
        failure: {
          code: "provider_unavailable",
          stepId: "plan",
          message: "secret",
        },
      }),
    /unsupported fields/,
  );
});

test("usage is reserved before consumption and unfinished reservations prevent successful completion", () => {
  let task = claim(create());
  assert.throws(
    () =>
      command(task, {
        kind: "settle_usage",
        modelTurns: 1,
        toolCalls: 0,
        consumed: true,
      }),
    /not reserved/,
  );
  task = command(task, {
    kind: "reserve_usage",
    modelTurns: 101,
    toolCalls: 24,
  });
  assert.throws(
    () => command(task, { kind: "reserve_usage", modelTurns: 0, toolCalls: 1 }),
    /range/,
  );
  assert.throws(
    () => command(task, { kind: "complete", result: result() }),
    /reservations/,
  );
  task = command(task, {
    kind: "settle_usage",
    modelTurns: 100,
    toolCalls: 20,
    consumed: true,
  });
  task = command(task, {
    kind: "settle_usage",
    modelTurns: 1,
    toolCalls: 4,
    consumed: false,
  });
  assert.equal(task.usage.modelTurns, 100);
  assert.equal(task.usage.toolCalls, 20);
  assert.throws(
    () =>
      command(task, {
        kind: "settle_usage",
        modelTurns: 1,
        toolCalls: 0,
        consumed: true,
      }),
    /not reserved/,
  );
  const finished = command(task, { kind: "complete", result: result() });
  assert.equal(finished.state, "ready");
});

test("prepared results must refer to the original project snapshot and cannot smuggle fields", () => {
  const task = claim(create());
  assert.throws(
    () =>
      command(task, {
        kind: "complete",
        result: { ...result(), baseFingerprint: "different" },
      }),
    /snapshot/,
  );
  assert.throws(
    () =>
      command(task, {
        kind: "complete",
        result: { ...result(), headers: { authorization: "secret" } },
      }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      command(task, {
        kind: "complete",
        result: {
          ...result(),
          artifact: {
            ...result().artifact,
            bytes: TASK_LIMITS.artifactBytes + 1,
          },
        },
      }),
    /range/,
  );
});

test("deadline expiry records a terminal reason even while queued or awaiting an answer", () => {
  const waiting = command(claim(create()), {
    kind: "ask",
    question: question(),
  });
  for (const task of [create(), waiting, claim(create())]) {
    assert.throws(
      () => command(task, { kind: "expire" }, { claim: null }),
      /past its deadline/,
    );
    const expired = command(
      task,
      { kind: "expire" },
      { now: task.deadlineAt, claim: null },
    );
    assert.equal(expired.state, "failed");
    assert.equal(expired.failure.code, "deadline_exceeded");
    assert.equal(expired.claim, null);
    assert.deepEqual(expired.questions, task.questions);
  }
});

test("only a settled journal permits trusted usage reconciliation after Stop", () => {
  let task = claim(create());
  task = command(task, { kind: "reserve_usage", modelTurns: 1, toolCalls: 0 });
  const receipt = {
    id: "inference",
    stepId: task.stepId,
    inputDigest: hash,
    status: "planned",
    resources: [],
    artifact: null,
    failure: null,
    createdAt: task.updatedAt + 1,
    updatedAt: task.updatedAt + 1,
  };
  task = command(task, { kind: "record_operation", operation: receipt });
  assert.throws(() =>
    command(
      task,
      {
        kind: "reconcile_usage",
        operationId: "inference",
        modelTurns: 1,
        toolCalls: 0,
        consumed: false,
      },
      { claim: null },
    ),
  );
  task = command(task, { kind: "stop" }, { claim: null });
  assert.throws(() =>
    command(task, {
      kind: "reconcile_usage",
      operationId: "inference",
      modelTurns: 1,
      toolCalls: 0,
      consumed: false,
    }),
  );
  task = command(task, {
    kind: "reconcile_operation",
    operation: {
      ...task.operations[0],
      status: "absent",
      updatedAt: task.updatedAt + 1,
    },
  });
  assert.throws(() =>
    command(task, {
      kind: "reconcile_usage",
      operationId: "missing",
      modelTurns: 1,
      toolCalls: 0,
      consumed: false,
    }),
  );
  task = command(task, {
    kind: "reconcile_usage",
    operationId: "inference",
    modelTurns: 1,
    toolCalls: 0,
    consumed: false,
  });
  assert.equal(task.state, "stopped");
  assert.equal(task.usage.modelTurns, 0);
  assert.equal(task.usage.reservedModelTurns, 0);
  assert.throws(() =>
    command(task, {
      kind: "reconcile_usage",
      operationId: "inference",
      modelTurns: 1,
      toolCalls: 0,
      consumed: false,
    }),
  );
});
