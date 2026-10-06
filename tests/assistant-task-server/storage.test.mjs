import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, NOW, path, expectStatus, saved } from "./helpers.mjs";
import { question, answer } from "../assistant-tasks/fixtures.mjs";
import { TASK_LIMITS } from "../../packages/pvo-assistant/tasks/index.js";

test("owned project resolution, concurrent creation replay and complete storage restart", async () => {
  const fixture = await taskFixture();
  try {
    const projects = await Promise.all(
      Array.from({ length: 6 }, () => fixture.project()),
    );
    projects.forEach((result) => expectStatus(result, 200));
    const projectId = projects[0].body.project.id;
    assert.equal(
      new Set(projects.map((result) => result.body.project.id)).size,
      1,
    );
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => fixture.create(projectId)),
    );
    assert.equal(responses.filter((result) => result.status === 201).length, 1);
    responses.forEach((result) =>
      assert.ok(
        [200, 201].includes(result.status),
        JSON.stringify(result.body),
      ),
    );
    const task = responses[0].body.task;
    assert.equal(
      new Set(responses.map((result) => result.body.task.id)).size,
      1,
    );
    assert.match(task.creationDigest, /^[a-f0-9]{64}$/);
    assert.equal(task.state, "queued");
    assert.equal(task.ownerId.length, 22);
    const reordered = Object.fromEntries(Object.entries(task.input).reverse());
    expectStatus(
      await fixture.request("/api/assistant/tasks", { body: reordered }),
      200,
    );
    expectStatus(
      await fixture.create(projectId, { request: "Changed request" }),
      409,
    );
    await fixture.restart();
    assert.deepEqual((await fixture.request(path(task))).body.task, task);
    assert.equal((await fixture.project()).body.project.id, projectId);
    assert.equal((await fixture.create(projectId)).body.task.id, task.id);
    const list = await fixture.request(
      `/api/assistant/tasks?project=${projectId}`,
    );
    assert.deepEqual(list.body, { tasks: [task], next: null });
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.equal(list.headers.get("access-control-allow-origin"), null);
    assert.equal(
      (await fixture.control({ action: "inspect" })).body.alarm,
      task.nextRunAt + 10,
    );
  } finally {
    await fixture.close();
  }
});

test("unfinished goals survive weeks and full restart; retention starts only after Stop", async () => {
  const fixture = await taskFixture();
  try {
    let task = await saved(fixture);
    for (const command of [
      { kind: "claim", claimId: "ask-first", leaseMs: 60000 },
      { kind: "ask", question: question() },
    ]) {
      const next = await fixture.control({
        action: "step",
        id: task.id,
        command,
      });
      expectStatus(next, 200);
      task = next.body;
    }
    const later = NOW + 30 * 86400000;
    await fixture.control({ action: "time", now: later });
    const kept = await fixture.control({ action: "sweep" });
    expectStatus(kept, 200);
    assert.deepEqual(kept.body.records[0], task);
    assert.equal(kept.body.records[0].expiresAt, null);
    await fixture.restart();
    await fixture.control({ action: "time", now: later });
    assert.deepEqual((await fixture.request(path(task))).body.task, task);
    expectStatus(await fixture.create(task.input.projectId), 200);
    const stopped = await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: task.revision },
    });
    expectStatus(stopped, 200);
    assert.equal(stopped.body.task.finishedAt, later);
    assert.equal(stopped.body.task.expiresAt, later + TASK_LIMITS.retentionMs);
    await fixture.control({ action: "time", now: stopped.body.task.expiresAt });
    const swept = await fixture.control({ action: "sweep" });
    assert.deepEqual(swept.body, { records: [], alarm: null, identities: 1 });
    expectStatus(await fixture.request(path(task)), 404);
    expectStatus(await fixture.create(task.input.projectId), 410);
    await fixture.restart();
    expectStatus(await fixture.create(task.input.projectId), 410);
  } finally {
    await fixture.close();
  }
});

test("project and retained-record bounds cannot be bypassed by new names or new days", async () => {
  const fixture = await taskFixture();
  try {
    const projectId = (await fixture.project()).body.project.id;
    for (let index = 1; index < 64; index++)
      expectStatus(await fixture.project(`draft-${index}`), 200);
    expectStatus(await fixture.project("one-too-many"), 429);
    expectStatus(await fixture.project(), 200);
    for (let day = 0; day < 4; day++) {
      await fixture.control({ action: "time", now: NOW + day * 86400000 });
      for (let index = 0; index < 8; index++) {
        const result = await fixture.create(projectId, {
          operationId: `task-${day}-${index}`,
        });
        expectStatus(result, 201);
        expectStatus(
          await fixture.request(path(result.body.task) + "/stop", {
            body: { expectedRevision: 0 },
          }),
          200,
        );
      }
    }
    await fixture.control({ action: "time", now: NOW + 4 * 86400000 });
    expectStatus(
      await fixture.create(projectId, { operationId: "too-many-retained" }),
      429,
    );
  } finally {
    await fixture.close();
  }
});
