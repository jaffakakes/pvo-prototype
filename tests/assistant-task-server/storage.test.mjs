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

test("deadline and retention alarms erase private content but preserve creation identity", async () => {
  const fixture = await taskFixture();
  try {
    const task = await saved(fixture);
    await fixture.control({
      action: "time",
      now: NOW + TASK_LIMITS.lifetimeMs,
    });
    const expired = await fixture.control({ action: "sweep" });
    assert.equal(expired.body.records[0].failure.code, "deadline_exceeded");
    assert.equal(expired.body.alarm, task.expiresAt);
    expectStatus(
      await fixture.request(path(task) + "/resume", {
        body: { expectedRevision: 1 },
      }),
      409,
    );
    await fixture.control({ action: "time", now: task.expiresAt });
    const swept = await fixture.control({ action: "sweep" });
    assert.deepEqual(swept.body, { records: [], alarm: null, identities: 1 });
    expectStatus(await fixture.request(path(task)), 404);
    expectStatus(await fixture.create(task.input.projectId), 410);
    await fixture.restart();
    expectStatus(await fixture.create(task.input.projectId), 410);
    assert.equal(
      (await fixture.project()).body.project.id,
      task.input.projectId,
    );
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
