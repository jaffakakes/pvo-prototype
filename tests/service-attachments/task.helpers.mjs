import assert from "node:assert/strict";
import {
  taskFixture,
  expectStatus,
  NOW,
} from "../assistant-task-server/helpers.mjs";
import {
  publishing,
  publish,
  current,
} from "../assistant-task-server/provider.helpers.mjs";
import { attachment } from "./fixtures.mjs";

export function proposal(task) {
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
export async function setup(options = {}) {
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
