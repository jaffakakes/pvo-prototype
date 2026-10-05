import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { taskFixture, NOW, path, expectStatus, saved } from "./helpers.mjs";
import { serializePreparedTaskResult } from "../../packages/pvo-assistant/results/index.js";
const operations = [
  {
    kind: "component.content",
    sceneId: "scene-one",
    componentId: "form-one",
    changes: { heading: "Dinner" },
  },
];
async function claim(fixture, task) {
  const response = await fixture.control({
    action: "step",
    id: task.id,
    command: { kind: "claim", claimId: "result-worker", leaseMs: 60000 },
  });
  expectStatus(response, 200);
  return response.body;
}
const guard = (task) => ({
  expectedRevision: task.revision,
  claim: { id: task.claim.id, generation: task.generation },
});
const complete = (fixture, task, changes = operations) =>
  fixture.control({
    action: "complete",
    id: task.id,
    operations: changes,
    guard: guard(task),
  });

test("owned immutable result survives restart and expires with private task content", async () => {
  const fixture = await taskFixture();
  try {
    const task = await claim(fixture, await saved(fixture));
    expectStatus(await fixture.request(path(task) + "/result"), 409);
    const completed = await complete(fixture, task);
    expectStatus(completed, 200);
    assert.equal(completed.body.state, "ready");
    assert.deepEqual((await complete(fixture, task)).body, completed.body);
    expectStatus(
      await complete(fixture, task, [
        { ...operations[0], changes: { heading: "Other" } },
      ]),
      409,
    );
    const result = await fixture.request(path(task) + "/result");
    expectStatus(result, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = serializePreparedTaskResult(result.body);
    assert.equal(completed.body.result.artifact.bytes, Buffer.byteLength(body));
    assert.equal(
      completed.body.result.artifact.sha256,
      createHash("sha256").update(body).digest("hex"),
    );
    expectStatus(
      await fixture.request(path(task) + "/result", {
        session: fixture.otherCookie,
      }),
      404,
    );
    expectStatus(
      await fixture.request(path(task) + "/result", { session: null }),
      401,
    );
    expectStatus(
      await fixture.request(path(task) + "/result", { body: {} }),
      404,
    );
    await fixture.restart();
    assert.deepEqual(
      (await fixture.request(path(task) + "/result")).body,
      result.body,
    );
    await fixture.control({ action: "time", now: task.expiresAt });
    await fixture.control({ action: "sweep" });
    expectStatus(await fixture.request(path(task) + "/result"), 404);
    assert.equal((await fixture.control({ action: "results" })).body.count, 0);
  } finally {
    await fixture.close();
  }
});

test("invalid output and stale completions cannot publish a result", async () => {
  const fixture = await taskFixture();
  try {
    const task = await claim(fixture, await saved(fixture));
    expectStatus(
      await complete(fixture, task, [{ kind: "playback.play" }]),
      409,
    );
    assert.equal(
      (await fixture.request(path(task))).body.task.state,
      "running",
    );
    assert.equal((await fixture.control({ action: "results" })).body.count, 0);
    expectStatus(
      await fixture.control({
        action: "complete",
        id: task.id,
        operations,
        guard: { ...guard(task), expectedRevision: 0 },
      }),
      409,
    );
    await fixture.request(path(task) + "/stop", {
      body: { expectedRevision: task.revision },
    });
    expectStatus(await complete(fixture, task), 409);
    assert.equal((await fixture.control({ action: "results" })).body.count, 0);
    const second = await claim(
      fixture,
      (await fixture.create(task.input.projectId, { operationId: "second" }))
        .body.task,
    );
    await fixture.control({ action: "time", now: NOW + 60000 });
    expectStatus(await complete(fixture, second), 409);
    assert.equal((await fixture.control({ action: "results" })).body.count, 0);
  } finally {
    await fixture.close();
  }
});

test("a failed artifact write rolls ready state back in the same SQLite transaction", async () => {
  const fixture = await taskFixture();
  try {
    const task = await claim(fixture, await saved(fixture));
    expectStatus(await fixture.control({ action: "fail-result-write" }), 200);
    expectStatus(await complete(fixture, task), 409);
    assert.deepEqual((await fixture.request(path(task))).body.task, task);
    assert.equal((await fixture.control({ action: "results" })).body.count, 0);
  } finally {
    await fixture.close();
  }
});
