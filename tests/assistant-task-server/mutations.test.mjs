import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, NOW, path, expectStatus, saved } from "./helpers.mjs";
import { question, answer } from "../assistant-tasks/fixtures.mjs";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";

test("saved questions and answers survive restart; revision races commit once", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    expectStatus(
      await fixture.control({
        action: "step",
        id: task.id,
        command: { kind: "claim", claimId: "worker", leaseMs: 60000 },
      }),
      200,
    );
    const asked = await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "ask", question: question() },
    });
    expectStatus(asked, 200);
    await fixture.restart();
    assert.deepEqual((await fixture.request(path(task))).body.task.questions, [
      question(),
    ]);
    const { kind, ...answerFields } = answer();
    const body = { expectedRevision: asked.body.revision, ...answerFields };
    expectStatus(
      await fixture.request(path(task) + "/answers", {
        body: { ...body, questionId: "missing" },
      }),
      409,
    );
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        fixture.request(path(task) + "/answers", { body }),
      ),
    );
    assert.equal(replies.filter((result) => result.status === 200).length, 1);
    assert.equal(replies.filter((result) => result.status === 409).length, 4);
    const answered = replies.find((result) => result.status === 200).body.task;
    assert.equal(answered.questions[0].answer.value, "Friday");
    const replay = await fixture.request(path(task) + "/answers", {
      body: { ...body, expectedRevision: answered.revision },
    });
    assert.deepEqual(replay.body.task, answered);
    expectStatus(
      await fixture.request(path(task) + "/answers", {
        body: {
          ...body,
          expectedRevision: answered.revision,
          value: "Saturday",
        },
      }),
      409,
    );
    const stops = await Promise.all(
      [1, 2].map(() =>
        fixture.request(path(task) + "/stop", {
          body: { expectedRevision: answered.revision },
        }),
      ),
    );
    assert.deepEqual(stops.map((result) => result.status).sort(), [200, 409]);
    const stopped = stops.find((result) => result.status === 200).body.task;
    assert.equal(stopped.state, "stopped");
    assert.ok(stopped.generation > answered.generation);
    await fixture.restart();
    assert.deepEqual((await fixture.request(path(task))).body.task, stopped);
  } finally {
    await fixture.close();
  }
});

test("resume uses current state and capacity survives restart", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "claim", claimId: "worker", leaseMs: 60000 },
    });
    const failed = await fixture.control({
      action: "step",
      id: task.id,
      command: {
        kind: "fail",
        failure: { code: "provider_unavailable", stepId: "plan" },
      },
    });
    const resumed = await fixture.request(path(task) + "/resume", {
      body: { expectedRevision: failed.body.revision },
    });
    expectStatus(resumed, 200);
    assert.equal(resumed.body.task.retries, 1);
    const race = await Promise.all(
      ["two", "three", "four"].map((operationId) =>
        fixture.create(task.input.projectId, { operationId }),
      ),
    );
    assert.equal(race.filter((result) => result.status === 201).length, 1);
    assert.equal(race.filter((result) => result.status === 429).length, 2);
    await fixture.restart();
    expectStatus(
      await fixture.create(task.input.projectId, { operationId: "another" }),
      429,
    );
    const current = (await fixture.request(path(task))).body.task;
    expectStatus(
      await fixture.request(path(task) + "/stop", {
        body: { expectedRevision: current.revision },
      }),
      200,
    );
    for (let index = 0; index < 6; index++) {
      const result = await fixture.create(task.input.projectId, {
        operationId: `daily-${index}`,
      });
      expectStatus(result, 201);
      await fixture.request(path(result.body.task) + "/stop", {
        body: { expectedRevision: 0 },
      });
    }
    expectStatus(
      await fixture.create(task.input.projectId, {
        operationId: "daily-overflow",
      }),
      429,
    );
    const page = await fixture.request(
      `/api/assistant/tasks?project=${task.input.projectId}&limit=3`,
    );
    assert.equal(page.body.tasks.length, 3);
    const next = await fixture.request(
      `/api/assistant/tasks?project=${task.input.projectId}&limit=3&before=${page.body.next}`,
    );
    assert.equal(next.body.tasks.length, 3);
    assert.equal(
      new Set([...page.body.tasks, ...next.body.tasks].map((item) => item.id))
        .size,
      6,
    );
  } finally {
    await fixture.close();
  }
});

test("Stop preserves unknown outcomes; stale workers and unreconciled resume are rejected", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    const claim = await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "claim", claimId: "worker", leaseMs: 60000 },
    });
    const operation = {
      id: "deploy",
      stepId: "plan",
      inputDigest: "a".repeat(64),
      status: "planned",
      resources: [],
      artifact: null,
      failure: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const recorded = await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "record_operation", operation },
    });
    expectStatus(recorded, 200);
    const failed = await fixture.control({
      action: "step",
      id: task.id,
      command: {
        kind: "fail",
        failure: { code: "interrupted", stepId: "plan" },
      },
    });
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: failed.body.revision },
      }),
      409,
    );
    const stopped = await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: failed.body.revision },
    });
    expectStatus(stopped, 200);
    assert.equal(stopped.body.task.operations[0].status, "unknown");
    expectStatus(
      await fixture.control({
        action: "step",
        id: task.id,
        expectedRevision: claim.body.revision,
        command: { kind: "checkpoint", stepId: "late" },
      }),
      409,
    );
    await fixture.control({
      action: "time",
      now: (await fixture.request(path(task))).body.task.expiresAt,
    });
    const retained = await fixture.control({ action: "sweep" });
    assert.equal(
      retained.body.records.length,
      1,
      "Unknown side effects cannot lose their journal to retention cleanup",
    );
    expectStatus(
      await fixture.request(path(task)),
      404,
      "Expired private task content is no longer returned",
    );
  } finally {
    await fixture.close();
  }
});

test("resuming a failed task cannot exceed the account's unfinished-task limit", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    await fixture.control({
      action: "step",
      id: task.id,
      command: { kind: "claim", claimId: "worker", leaseMs: 60000 },
    });
    const failed = await fixture.control({
      action: "step",
      id: task.id,
      command: {
        kind: "fail",
        failure: { code: "provider_unavailable", stepId: "plan" },
      },
    });
    for (const operationId of ["second", "third"])
      expectStatus(
        await fixture.create(task.input.projectId, { operationId }),
        201,
      );
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: failed.body.revision },
      }),
      429,
    );
    assert.deepEqual(
      (await fixture.request(path(task))).body.task,
      failed.body,
    );
  } finally {
    await fixture.close();
  }
});
