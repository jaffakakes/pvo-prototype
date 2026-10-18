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

test("saved goals continue past former minute and daily caps across restart without duplicate dispatch", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return Response.json(
        calls === 65
          ? { kind: "ask", question: question() }
          : { kind: "checkpoint", stepId: "plan" },
      );
    },
  });
  try {
    const original = await saved(fixture);
    await sweep(fixture, 16);
    const checkpoint = await read(fixture, original);
    assert.equal(calls, 32);
    assert.equal(checkpoint.usage.modelTurns, 32);
    assert.equal(checkpoint.wait, null);
    await fixture.restart();
    assert.deepEqual(await read(fixture, original), checkpoint);
    await sweep(fixture, 17);
    const done = await read(fixture, original);
    assert.equal(done.id, original.id);
    assert.equal(done.state, "waiting_for_answer");
    assert.equal(done.wait, null);
    assert.equal(done.usage.modelTurns, 65);
    assert.equal(done.usage.reservedModelTurns, 0);
    assert.equal(calls, 65);
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

test("Stop prevents a provider capacity wait from retrying", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () => {
      calls++;
      return Response.json({ error: "Provider busy" }, { status: 429 });
    },
  });
  try {
    const original = await saved(fixture);
    await sweep(fixture);
    const waiting = await read(fixture, original);
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.wait.reason, "model_capacity");
    expectStatus(
      await fixture.request(path(original) + "/stop", {
        body: { expectedRevision: waiting.revision },
      }),
      200,
    );
    await fixture.restart();
    await fixture.control({ action: "time", now: NOW + 86400000 });
    await sweep(fixture);
    assert.equal(calls, 1);
    assert.equal((await read(fixture, original)).state, "stopped");
  } finally {
    await fixture.close();
  }
});

test("a provider 429 retries the same saved goal after backoff", async () => {
  let calls = 0;
  const fixture = await taskFixture({
    clock: NOW,
    planner: async () =>
      ++calls === 1
        ? Response.json({ error: "Provider busy" }, { status: 429 })
        : Response.json({ kind: "ask", question: question() }),
  });
  try {
    const original = await saved(fixture);
    await sweep(fixture);
    const waiting = await read(fixture, original);
    assert.equal(waiting.wait.reason, "model_capacity");
    await fixture.restart();
    await sweep(fixture);
    assert.equal(calls, 1);
    await fixture.control({ action: "time", now: waiting.nextRunAt });
    await sweep(fixture);
    const resumed = await read(fixture, original);
    assert.equal(resumed.id, original.id);
    assert.equal(resumed.state, "waiting_for_answer");
    assert.equal(calls, 2);
  } finally {
    await fixture.close();
  }
});
