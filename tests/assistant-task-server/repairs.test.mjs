import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, saved, path, NOW, expectStatus } from "./helpers.mjs";
import { current, deferred } from "./provider.helpers.mjs";
import { AuthoringRepairError } from "../../server/assistant/tasks/repairFeedback.js";

const request = {
  kind: "history",
  collection: "repairs",
  after: 0,
  offset: 0,
  notes: "Read the actual failure before repairing.",
};
const invalid = {
  kind: "ask",
  question: { prompt: "Missing required fields" },
};
const history = (f, task) =>
  f.control({ action: "select-evidence", id: task.id, request });

test("reading repair history preserves the repeated-check signal across restart and Stop prunes private repairs after retention", async () => {
  const calls = [];
  const f = await taskFixture({
    clock: NOW,
    planner: async (requestBody) => {
      calls.push(await requestBody.json());
      return Response.json(calls.length === 2 ? request : invalid);
    },
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    expectStatus(await f.control({ action: "sweep" }), 200);
    assert.equal((await current(f, task)).state, "queued");
    const first = await history(f, task);
    expectStatus(first, 200);
    assert.equal(JSON.parse(first.body.content).repetitions, 1);
    await f.restart();
    expectStatus(await f.control({ action: "sweep" }), 200);
    const waiting = await current(f, task);
    assert.equal(waiting.state, "waiting_for_answer");
    assert.equal(waiting.usage.modelTurns, 4);
    assert.equal(calls[2].evidenceContext.repair.repetitions, 1);
    assert.equal(calls[3].evidenceContext.repair.repetitions, 2);
    assert.equal(
      calls[2].evidenceContext.selection.content,
      first.body.content,
    );
    assert.equal(
      waiting.operations.filter((row) => row.status === "failed").length,
      3,
    );
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: waiting.revision },
      }),
      200,
    );
    await f.control({ action: "time", now: NOW + 7 * 86400000 + 1 });
    await f.control({ action: "sweep" });
    expectStatus(await f.request(path(task)), 404);
    expectStatus(await history(f, task), 409);
  } finally {
    await f.close();
  }
});

test("a late invalid proposal cannot save repair feedback or queue work after Stop", async () => {
  const entered = deferred(),
    release = deferred();
  const f = await taskFixture({
    clock: NOW,
    planner: async () => {
      entered.resolve();
      await release.promise;
      return Response.json(invalid);
    },
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    const running = f.control({ action: "sweep" });
    await entered.promise;
    const before = await current(f, task);
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: before.revision },
      }),
      200,
    );
    release.resolve();
    await running;
    const stopped = await current(f, task);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.usage.modelTurns, 1);
    assert.equal(stopped.usage.reservedModelTurns, 0);
    assert.equal(stopped.questions.length, 0);
    assert.equal((await history(f, task)).body.sequence, null);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("repair storage failure rolls back the checkpoint, failed receipt and usage settlement together", async () => {
  const f = await taskFixture({
    clock: NOW,
    planner: async () => Response.json(invalid),
  });
  try {
    await f.control({ action: "time", now: NOW });
    const task = await saved(f);
    await f.control({ action: "repair-write-failure", enabled: true });
    expectStatus(await f.control({ action: "sweep" }), 409);
    const pending = await current(f, task);
    assert.equal(pending.state, "running");
    assert.equal(pending.usage.reservedModelTurns, 1);
    assert.equal(pending.usage.modelTurns, 0);
    assert.equal(pending.operations[0].status, "planned");
    assert.equal((await history(f, task)).body.sequence, null);
    await f.control({ action: "repair-write-failure", enabled: false });
    await f.restart();
    await f.control({ action: "time", now: pending.claim.expiresAt + 1 });
    expectStatus(await f.control({ action: "sweep" }), 200);
    const recovered = await current(f, task);
    assert.equal(recovered.usage.reservedModelTurns, 0);
    assert.equal(recovered.usage.modelTurns, 3);
    assert.equal(
      JSON.parse((await history(f, task)).body.content).repetitions,
      1,
    );
  } finally {
    await f.close();
  }
});

test("saved rejected proposals and diagnostic previews remain finite without splitting Unicode", () => {
  const error = new AuthoringRepairError(
    "component_validation",
    "😀".repeat(1024),
    "😀".repeat(40000),
  );
  assert.equal(error.code, "invalid_result");
  assert.equal(new TextEncoder().encode(error.feedback.message).length, 2048);
  assert.equal(
    new TextEncoder().encode(error.feedback.proposal.text).length,
    128 * 1024,
  );
  assert.equal(error.feedback.proposal.truncated, true);
  assert.equal(error.feedback.proposal.text.includes("\ufffd"), false);
});
