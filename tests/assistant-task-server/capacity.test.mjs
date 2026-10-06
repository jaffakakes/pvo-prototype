import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, path, saved, NOW, expectStatus } from "./helpers.mjs";
import { question } from "../assistant-tasks/fixtures.mjs";

async function read(fixture, task) {
  return (await fixture.request(path(task))).body.task;
}
async function sweep(fixture, count = 1) {
  for (let index = 0; index < count; index++)
    expectStatus(await fixture.control({ action: "sweep" }), 200);
}

test("minute and daily capacity waits survive restart and resume the same saved goal without duplicate dispatch", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return Response.json(
        calls === 21
          ? { kind: "ask", question: question() }
          : { kind: "checkpoint", stepId: "plan" },
      );
    },
  });
  try {
    const original = await saved(fixture);
    await sweep(fixture, 7);
    const minute = await read(fixture, original);
    assert.equal(calls, 12);
    assert.equal(minute.state, "waiting");
    assert.equal(minute.wait.reason, "model_capacity");
    assert.equal(minute.nextRunAt, NOW + 60000);
    assert.equal(minute.usage.modelTurns, 12);
    assert.equal(minute.usage.reservedModelTurns, 0);
    assert.equal(minute.operations.at(-1).status, "absent");
    await fixture.restart();
    assert.deepEqual(await read(fixture, original), minute);
    await sweep(fixture);
    assert.equal(calls, 12);
    await fixture.control({ action: "time", now: NOW + 60000 });
    await sweep(fixture, 5);
    const daily = await read(fixture, original);
    assert.equal(calls, 20);
    assert.equal(daily.state, "waiting");
    assert.equal(daily.wait.reason, "model_allowance");
    assert.equal(daily.nextRunAt, NOW + 86400000);
    assert.equal(daily.usage.modelTurns, 20);
    assert.equal(daily.expiresAt, null);
    await fixture.restart();
    assert.deepEqual(await read(fixture, original), daily);
    // Waiting remains an active saved goal: rechecking it must not consume a third slot.
    await fixture.control({ action: "time", now: NOW + 60000 });
    const other = await fixture.create(original.input.projectId, {
      operationId: "other-active",
    });
    expectStatus(other, 201);
    for (const command of [
      { kind: "claim", claimId: "other-worker", leaseMs: 60000 },
      { kind: "ask", question: question() },
    ])
      expectStatus(
        await fixture.control({
          action: "step",
          id: other.body.task.id,
          command,
        }),
        200,
      );
    // Creator Resume asks the budget again. It never grants or resets capacity.
    expectStatus(
      await fixture.request(path(original) + "/resume", {
        body: { expectedRevision: daily.revision },
      }),
      200,
    );
    await fixture.control({ action: "time", now: NOW + 60000 });
    await sweep(fixture);
    assert.equal(calls, 20);
    assert.equal(
      (await read(fixture, original)).wait.reason,
      "model_allowance",
    );
    await fixture.control({ action: "time", now: NOW + 86400000 });
    await sweep(fixture);
    const done = await read(fixture, original);
    assert.equal(done.id, original.id);
    assert.equal(done.state, "waiting_for_answer");
    assert.equal(done.wait, null);
    assert.equal(done.usage.modelTurns, 21);
    assert.equal(calls, 21);
    assert.deepEqual(done.input, original.input);
    const inspection = await fixture.control({ action: "attempt-rows" });
    assert.ok(
      inspection.body.every(
        (attempt) => attempt.finished && attempt.budgetSettled,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test("Stop prevents a saved capacity wait from waking after the reset", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return Response.json({ kind: "checkpoint", stepId: "plan" });
    },
  });
  try {
    const original = await saved(fixture);
    await sweep(fixture, 7);
    const waiting = await read(fixture, original);
    assert.equal(waiting.state, "waiting");
    expectStatus(
      await fixture.request(path(original) + "/stop", {
        body: { expectedRevision: waiting.revision },
      }),
      200,
    );
    await fixture.restart();
    await fixture.control({ action: "time", now: NOW + 86400000 });
    await sweep(fixture);
    assert.equal(calls, 12);
    assert.equal((await read(fixture, original)).state, "stopped");
  } finally {
    await fixture.close();
  }
});
