import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, NOW, expectStatus } from "./helpers.mjs";
import { question } from "../assistant-tasks/fixtures.mjs";

const read = async (fixture, task) =>
  (await fixture.request(path(task))).body.task;
const sweep = async (fixture) =>
  expectStatus(await fixture.control({ action: "sweep" }), 200);

test("an unavailable inference retries unchanged saved input across restart and accounts for both attempts", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () =>
      ++calls === 1
        ? new Response(null, { status: 503 })
        : Response.json({ kind: "ask", question: question() }),
  });
  try {
    const task = await saved(fixture);
    await sweep(fixture);
    const waiting = await read(fixture, task);
    assert.equal(waiting.wait.reason, "model_connection");
    assert.equal(waiting.nextRunAt, NOW + 10000);
    assert.equal(waiting.operations[0].failure.code, "provider_unavailable");
    assert.equal(waiting.usage.modelTurns, 1);
    assert.equal(waiting.usage.reservedModelTurns, 0);
    await fixture.restart();
    assert.deepEqual(await read(fixture, task), waiting);
    await sweep(fixture);
    assert.equal(calls, 1, "Backoff cannot be bypassed by another wakeup");
    await fixture.control({ action: "time", now: waiting.nextRunAt });
    await sweep(fixture);
    const recovered = await read(fixture, task);
    assert.equal(recovered.state, "waiting_for_answer");
    assert.deepEqual(recovered.input, task.input);
    assert.equal(recovered.usage.modelTurns, 2);
    assert.equal(recovered.usage.reservedModelTurns, 0);
    assert.equal(calls, 2);
    assert.equal(
      recovered.operations[0].inputDigest,
      recovered.operations[1].inputDigest,
    );
    const journal = (await fixture.control({ action: "attempt-rows" })).body;
    assert.equal(journal.length, 2);
    assert.ok(
      journal.every((attempt) => attempt.finished && attempt.budgetSettled),
    );
  } finally {
    await fixture.close();
  }
});

test("Stop during an inference retry wait survives restart without another dispatch", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return new Response(null, { status: 503 });
    },
  });
  try {
    const task = await saved(fixture);
    await sweep(fixture);
    const waiting = await read(fixture, task);
    assert.equal(waiting.wait.reason, "model_connection");
    expectStatus(
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: waiting.revision },
      }),
      200,
    );
    await fixture.restart();
    await fixture.control({ action: "time", now: NOW + 86400000 });
    await sweep(fixture);
    assert.equal((await read(fixture, task)).state, "stopped");
    assert.equal(calls, 1);
  } finally {
    await fixture.close();
  }
});

test("repeated transport failure stops automatic retries but preserves a creator's later Retry", async () => {
  let calls = 0;
  let unavailable = true;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return unavailable
        ? new Response(null, { status: 503 })
        : Response.json({ kind: "ask", question: question() });
    },
  });
  try {
    const task = await saved(fixture);
    await sweep(fixture);
    const first = await read(fixture, task);
    await fixture.control({ action: "time", now: first.nextRunAt });
    await sweep(fixture);
    const second = await read(fixture, task);
    assert.equal(second.nextRunAt, first.nextRunAt + 30000);
    await fixture.control({ action: "time", now: second.nextRunAt });
    await sweep(fixture);
    const failed = await read(fixture, task);
    assert.equal(failed.state, "failed");
    assert.equal(failed.failure.code, "provider_unavailable");
    assert.equal(failed.usage.modelTurns, 3);
    assert.equal(calls, 3);
    await fixture.restart();
    await fixture.control({ action: "time", now: NOW + 86400000 });
    await sweep(fixture);
    assert.equal(calls, 3);
    unavailable = false;
    const current = await read(fixture, task);
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: current.revision },
      }),
      200,
    );
    await sweep(fixture);
    assert.equal((await read(fixture, task)).state, "waiting_for_answer");
    assert.equal(calls, 4, "This is not a total saved-goal request ceiling");
  } finally {
    await fixture.close();
  }
});
