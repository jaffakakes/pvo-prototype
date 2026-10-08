import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { taskFixture, path, expectStatus, saved } from "./helpers.mjs";
import { question } from "../assistant-tasks/fixtures.mjs";

async function until(read, predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail("Saved task did not reach its expected state");
}
const state = (fixture, task) =>
  fixture.request(path(task)).then((result) => result.body.task);

test("a model reply near its deadline retains a claim long enough to settle exactly once", async () => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const fixture = await taskFixture({
    productionLeases: true,
    planner: async () => {
      calls++;
      entered();
      await pending;
      return Response.json({ kind: "ask", question: question() });
    },
  });
  try {
    const task = await saved(fixture);
    await started;
    const running = await state(fixture, task);
    // Model decoding and receipt settlement may extend beyond the former 60-second claim.
    await fixture.control({ action: "time", now: running.updatedAt + 65000 });
    release();
    const result = await until(
      () => state(fixture, task),
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(calls, 1);
    assert.equal(result.usage.modelTurns, 1);
    assert.equal(result.usage.reservedModelTurns, 0);
    assert.equal(result.operations[0].status, "completed");
    await fixture.restart();
    assert.deepEqual(await state(fixture, task), result);
  } finally {
    release();
    await fixture.close();
  }
});

test("a persisted alarm runs after creation returns, saves a question, and continues after runtime restart", async () => {
  const calls = [];
  const fixture = await taskFixture({
    planner: async (request) => {
      const task = await request.json();
      calls.push(task);
      return Response.json(
        task.questions.length
          ? { kind: "checkpoint", stepId: "build" }
          : { kind: "ask", question: question() },
      );
    },
  });
  try {
    const task = await saved(fixture);
    // No HTTP progress request drives execution: the durable alarm invokes the planner itself.
    await until(
      async () => calls.length,
      (count) => count === 1,
    );
    const waiting = await until(
      () => state(fixture, task),
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(waiting.usage.modelTurns, 1);
    assert.equal(waiting.usage.reservedModelTurns, 0);
    assert.equal(waiting.operations[0].status, "completed");
    await fixture.restart();
    const restored = await state(fixture, task);
    assert.deepEqual(restored, waiting);
    expectStatus(
      await fixture.request(path(task) + "/answers", {
        body: {
          expectedRevision: restored.revision,
          questionId: "date",
          questionRevision: 0,
          operationId: "answer-date",
          value: "Friday",
        },
      }),
      200,
    );
    const finished = await until(
      () => state(fixture, task),
      (value) => value.state === "failed",
    );
    assert.equal(finished.stepId, "build");
    assert.equal(
      finished.failure.code,
      "provider_unavailable",
      "Unimplemented workspace capability cannot pretend to finish the build",
    );
    assert.equal(finished.usage.modelTurns, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].questions[0].answer.value, "Friday");
  } finally {
    await fixture.close();
  }
});

test("racing durable wakeups acquire one current claim and one inference reservation", async () => {
  let count = 0;
  const fixture = await taskFixture({
    planner: async () => {
      count++;
      await delay(180);
      return Response.json({ kind: "ask", question: question() });
    },
  });
  try {
    const task = await saved(fixture);
    await Promise.all(
      [1, 2, 3].map(() => fixture.control({ action: "sweep" })),
    );
    const result = await until(
      () => state(fixture, task),
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(count, 1);
    assert.equal(result.operations.length, 1);
    assert.equal(result.usage.modelTurns, 1);
  } finally {
    await fixture.close();
  }
});

test("Stop cancels a delayed step and its late response cannot ask, complete or start another effect", async () => {
  let count = 0;
  const fixture = await taskFixture({
    planner: async () => {
      count++;
      await delay(300);
      return Response.json({ kind: "checkpoint", stepId: "plan" });
    },
  });
  try {
    const task = await saved(fixture);
    await until(
      async () => count,
      (value) => value === 1,
    );
    const running = await state(fixture, task);
    const stopped = await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: running.revision },
    });
    expectStatus(stopped, 200);
    await delay(500);
    const result = await state(fixture, task);
    assert.equal(result.state, "stopped");
    assert.equal(result.usage.reservedModelTurns, 0);
    assert.equal(result.usage.modelTurns, 1);
    assert.equal(result.operations[0].status, "failed");
    assert.equal(count, 1);
    assert.equal(result.questions.length, 0);
  } finally {
    await fixture.close();
  }
});

test("an expired inference claim recovers its journal and rejects the old result", async () => {
  let count = 0;
  const fixture = await taskFixture({
    planner: async () => {
      const call = ++count;
      if (call === 1) await delay(600);
      return Response.json({
        kind: "ask",
        question: {
          ...question(),
          prompt: call === 1 ? "Old result" : "Recovered result",
        },
      });
    },
  });
  try {
    const task = await saved(fixture);
    await until(
      async () => count,
      (value) => value === 1,
    );
    const running = await state(fixture, task);
    await fixture.control({ action: "time", now: running.claim.expiresAt + 1 });
    expectStatus(await fixture.control({ action: "sweep" }), 200);
    await delay(700);
    const result = await state(fixture, task);
    assert.equal(count, 2);
    assert.equal(result.state, "waiting_for_answer");
    assert.equal(result.questions[0].prompt, "Recovered result");
    assert.equal(result.retries, 1);
    assert.equal(result.operations[0].status, "failed");
    assert.equal(result.operations[1].status, "completed");
    assert.equal(result.usage.modelTurns, 2);
  } finally {
    await fixture.close();
  }
});

test("a saved goal continues past the former eight-turn cutoff and can ask for necessary input", async () => {
  let count = 0;
  const fixture = await taskFixture({
    planner: async () => {
      count++;
      return Response.json(
        count === 10
          ? { kind: "ask", question: question() }
          : { kind: "checkpoint", stepId: "plan" },
      );
    },
  });
  try {
    const task = await saved(fixture);
    const result = await until(
      () => state(fixture, task),
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(result.failure, null);
    assert.equal(count, 10);
    assert.equal(result.usage.modelTurns, 10);
    assert.equal(result.usage.reservedModelTurns, 0);
  } finally {
    await fixture.close();
  }
});

test("invalid planning output asks for help after repeated failures; a timeout retains its saved failure", async () => {
  for (const slow of [false, true]) {
    const fixture = await taskFixture({
      planner: async () => {
        if (slow) await delay(1300);
        return Response.json(
          slow
            ? { kind: "ask", question: question() }
            : { kind: "ask", question: { prompt: "Missing fields" } },
        );
      },
    });
    try {
      const task = await saved(fixture);
      const result = await until(
        () => state(fixture, task),
        (value) => value.state === (slow ? "failed" : "waiting_for_answer"),
      );
      if (slow) assert.equal(result.failure.code, "interrupted");
      else {
        assert.equal(result.failure, null);
        assert.equal(result.usage.modelTurns, 3);
        assert.match(result.questions[0].prompt, /valid plan/);
      }
      assert.equal(result.usage.reservedModelTurns, 0);
      await delay(400);
      assert.equal(
        (await state(fixture, task)).state,
        slow ? "failed" : "waiting_for_answer",
      );
    } finally {
      await fixture.close();
    }
  }
});

test("destroying the runtime during inference resumes from its saved claim without accepting the old reply", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    planner: async () => {
      const call = ++calls;
      if (call === 1) await delay(2200);
      return Response.json({
        kind: "ask",
        question: {
          ...question(),
          prompt:
            call === 1 ? "Reply from destroyed process" : "Reply after restart",
        },
      });
    },
  });
  try {
    const task = await saved(fixture);
    await until(
      async () => calls,
      (value) => value === 1,
    );
    const running = await state(fixture, task);
    assert.equal(running.state, "running");
    await fixture.restart();
    const recovered = await until(
      () => state(fixture, task),
      (value) => value.state === "waiting_for_answer",
    );
    assert.equal(recovered.questions[0].prompt, "Reply after restart");
    assert.equal(recovered.retries, 1);
    assert.equal(recovered.usage.modelTurns, 2);
    assert.equal(calls, 2);
    await delay(750);
    assert.deepEqual(
      (await state(fixture, task)).questions,
      recovered.questions,
    );
  } finally {
    await fixture.close();
  }
});
