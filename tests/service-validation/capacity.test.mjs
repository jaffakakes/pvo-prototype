import test from "node:test";
import assert from "node:assert/strict";
import {
  taskFixture,
  saved,
  path,
  expectStatus,
  current,
  planner,
  validation,
} from "./task.helpers.mjs";
import { NOW } from "../assistant-task-server/helpers.mjs";

async function advance(f, task, predicate) {
  for (let i = 0; i < 30; i++) {
    await f.control({ action: "sweep" });
    const value = await current(f, task);
    if (predicate(value)) return value;
  }
  assert.fail("Expected validation state was not reached");
}

test("hosted execution capacity wait preserves a checked step prefix through restart, then continues without source repair", async () => {
  let wait = true;
  const executions = [],
    model = [];
  const f = await taskFixture({
    clock: NOW,
    services: true,
    workspaces: true,
    planner: planner({ observe: (t) => model.push(t.stepId) }),
    validationControl: async (request) => {
      const value = await request.json();
      if (value.phase === "before") {
        executions.push(value.step);
        if (value.step === 2 && wait) {
          wait = false;
          return Response.json({
            wait: { code: "execution_capacity", retryAt: NOW + 30000 },
          });
        }
      }
      return Response.json({});
    },
  });
  try {
    const task = await saved(f);
    const paused = await advance(f, task, (t) => t.state === "waiting");
    assert.equal(paused.wait.reason, "service_capacity");
    assert.equal(paused.stepId, "validate");
    assert.equal(paused.nextRunAt, NOW + 30000);
    const before = await validation(f, task);
    assert.equal(before.artifacts[0].cursor.step, 2);
    assert.equal(before.artifacts[0].report.status, "running");
    const modelBefore = model.length;
    await f.restart();
    assert.deepEqual(await validation(f, task), before);
    await f.control({ action: "time", now: NOW + 30000 });
    const end = await advance(f, task, (t) => t.state === "waiting_for_answer");
    assert.equal(end.stepId, "attach");
    assert.deepEqual(executions, [0, 1, 2, 2, 3]);
    assert.equal(
      (await validation(f, task)).artifacts[0].report.status,
      "passed",
    );
    assert.ok(
      model.slice(modelBefore).length > 0 &&
        model.slice(modelBefore).every((step) => step === "attach"),
      "Capacity does not send checked source back for AI repair",
    );
  } finally {
    await f.close();
  }
});

test("Stop during hosted allowance waiting keeps the draft and cannot wake more tests", async () => {
  let calls = 0;
  const f = await taskFixture({
    clock: NOW,
    services: true,
    workspaces: true,
    planner: planner(),
    validationControl: async (request) => {
      if ((await request.json()).phase === "before") {
        calls++;
        return Response.json({
          wait: { code: "execution_allowance", retryAt: NOW + 86400000 },
        });
      }
      return Response.json({});
    },
  });
  try {
    const task = await saved(f),
      paused = await advance(f, task, (t) => t.state === "waiting");
    assert.equal(paused.wait.reason, "service_allowance");
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: paused.revision },
      }),
      200,
    );
    await f.restart();
    await f.control({ action: "time", now: NOW + 86400000 });
    await f.control({ action: "sweep" });
    assert.equal((await current(f, task)).state, "stopped");
    assert.equal(calls, 1);
    assert.equal(
      (await validation(f, task)).artifacts[0].report.status,
      "running",
    );
  } finally {
    await f.close();
  }
});
