import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  taskFixture,
  expectStatus,
  NOW,
  path,
} from "../assistant-task-server/helpers.mjs";
import {
  publishing,
  publish,
  current,
  deferred,
} from "../assistant-task-server/provider.helpers.mjs";
import { attachment } from "./fixtures.mjs";
import { serializePreparedTaskResult } from "../../packages/pvo-assistant/results/index.js";

function proposal(task) {
  const context = task.attachmentContext;
  const value = attachment(context.releaseId);
  value.component.sceneId = "scene-one";
  value.component.source = {
    structure:
      '<form><heading>Join dinner</heading><field name="guest" kind="name" label="Name"/><submit>Join</submit></form>',
    style: "",
    logic: `on submit { request(${JSON.stringify({ url: context.url, method: "POST", body: JSON.stringify({ operation: "join", input: value.connection.input }), onSuccess: { kind: "continue" }, onError: null })}); }`,
  };
  return value;
}
async function setup(options = {}) {
  const calls = [];
  const f = await taskFixture({
    services: true,
    clock: NOW,
    ...options,
    planner: async (request) => {
      const task = await request.json();
      calls.push(task);
      return Response.json(
        options.propose ? options.propose(task) : proposal(task),
      );
    },
  });
  try {
    await f.control({ action: "time", now: NOW }); // Manual durable alarms, actual SQLite/RPC/compiler.
    let task = await publishing(f);
    expectStatus(await publish(f, task), 200);
    task = await current(f, task);
    const next = await f.control({
      action: "step",
      id: task.id,
      command: { kind: "checkpoint", stepId: "attach" },
    });
    assert.equal(
      next.status,
      200,
      JSON.stringify({
        response: next.body,
        state: task.state,
        step: task.stepId,
        failure: task.failure,
        usage: task.usage,
        operations: task.operations.map((item) => ({
          stepId: item.stepId,
          status: item.status,
        })),
      }),
    );
    return { f, task: next.body, calls };
  } catch (error) {
    await f.close();
    throw error;
  }
}

test("the durable attach runner compiles a public connection and saves owned immutable result bytes across full restart", async () => {
  const { f, task, calls } = await setup();
  try {
    expectStatus(await f.control({ action: "sweep" }), 200);
    const ready = await current(f, task);
    assert.equal(ready.state, "ready", JSON.stringify(ready.failure));
    assert.equal(ready.usage.modelTurns, 1);
    assert.equal(ready.usage.reservedModelTurns, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].attachmentContext.operations.map((operation) => operation.name),
      ["join"],
    );
    assert.deepEqual(Object.keys(calls[0].attachmentContext).sort(), [
      "operations",
      "releaseId",
      "url",
    ]);
    const result = await f.request(path(task) + "/result");
    expectStatus(result, 200);
    assert.equal(result.body.attachment.receipt.identity.ownerId, task.ownerId);
    assert.equal(result.body.attachment.receipt.identity.taskId, task.id);
    assert.equal(result.body.attachment.receipt.readiness.state, "available");
    assert.deepEqual(result.body.operations, [
      result.body.attachment.command.component,
    ]);
    const bytes = serializePreparedTaskResult(result.body);
    assert.equal(
      ready.result.artifact.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    expectStatus(
      await f.request(path(task) + "/result", { session: f.otherCookie }),
      404,
    );
    const catalog = (await f.control({ action: "service-catalog" })).body;
    assert.equal(
      catalog[0].service.state,
      "inactive",
      "saving a component never activates its service",
    );
    await f.restart();
    assert.deepEqual(
      (await f.request(path(task) + "/result")).body,
      result.body,
    );
    assert.equal((await f.control({ action: "results" })).body.count, 1);
  } finally {
    await f.close();
  }
});

test("invalid source, invented release, wrong control and hidden originals cannot produce a ready attachment", async () => {
  for (const failure of ["source", "release", "control", "original"]) {
    const { f, task } = await setup({
      propose: (task) => {
        const command = proposal(task);
        if (failure === "source")
          command.component.source.structure = "<script>bad</script>";
        if (failure === "release") command.connection.releaseId = "invented";
        if (failure === "control") command.connection.target = "invented";
        if (failure === "original")
          command.component = {
            kind: "component.source",
            sceneId: "scene-one",
            componentId: "missing",
            source: command.component.source,
          };
        return command;
      },
    });
    try {
      expectStatus(await f.control({ action: "sweep" }), 200);
      const end = await current(f, task);
      assert.equal(end.state, "failed");
      assert.equal(end.failure.code, "invalid_result");
      assert.equal(end.usage.modelTurns, 1);
      assert.equal(end.result, null);
      assert.equal((await f.control({ action: "results" })).body.count, 0);
    } finally {
      await f.close();
    }
  }
});

test("Stop during real provider lookup fences a late prepared attachment and settles its metered turn", async () => {
  const entered = deferred(),
    release = deferred();
  let holding = false;
  const { f, task } = await setup({
    providerControl: async (request) => {
      const value = await request.json();
      if (holding && value.action === "lookup" && value.phase === "after") {
        entered.resolve();
        await release.promise;
      }
      return Response.json({});
    },
  });
  try {
    holding = true;
    const running = f.control({ action: "sweep" });
    await entered.promise;
    const latest = await current(f, task);
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: latest.revision },
      }),
      200,
    );
    release.resolve();
    await running;
    const stopped = await current(f, task);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.result, null);
    assert.equal(stopped.usage.modelTurns, 1);
    assert.equal(stopped.usage.reservedModelTurns, 0);
    assert.equal((await f.control({ action: "results" })).body.count, 0);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("result storage failure rolls back ready state and its inference receipt together", async () => {
  const { f, task } = await setup();
  try {
    expectStatus(await f.control({ action: "fail-result-write" }), 200);
    expectStatus(await f.control({ action: "sweep" }), 409);
    const end = await current(f, task);
    assert.notEqual(end.state, "ready");
    assert.equal(end.result, null);
    assert.equal((await f.control({ action: "results" })).body.count, 0);
    assert.equal(
      end.operations.find((operation) => operation.stepId === "attach").status,
      "planned",
    );
    assert.equal(
      end.usage.reservedModelTurns,
      1,
      "the lost completion remains reserved for recovery",
    );
  } finally {
    await f.close();
  }
});
