import assert from "node:assert/strict";
import { forwardModelRequest } from "./provider.mjs";
import {
  expectStatus,
  path,
} from "../../../tests/assistant-task-server/helpers.mjs";

/** Lose one completed read-only inference reply, while preserving its real usage in the journal. */
export function lostInferenceReply(send, record) {
  let lost = false;
  return async (request) => {
    const response = await forwardModelRequest(send, request);
    if (lost || !response.ok) return response;
    lost = true;
    await response.body?.cancel();
    await record({ kind: "reply_lost", at: new Date().toISOString() });
    return new Response(null, { status: 503 });
  };
}

/** Exercise the same explicit Retry as a creator after a transport failure, without supplying AI hints. */
export async function resumeLostInference(fixture, task) {
  assert.equal(task.state, "failed");
  assert.equal(task.failure?.code, "provider_unavailable");
  assert.equal(task.result, null);
  assert.equal(task.usage.modelTurns, 1);
  await fixture.restart();
  const restored = (await fixture.request(path(task))).body.task;
  assert.equal(restored.id, task.id);
  assert.deepEqual(restored.input, task.input);
  assert.deepEqual(restored.failure, task.failure);
  assert.deepEqual(restored.operations, task.operations);
  const resumed = await fixture.request(path(task) + "/resume", {
    body: { expectedRevision: restored.revision },
  });
  expectStatus(resumed, 200);
  assert.equal(resumed.body.task.state, "queued");
  assert.deepEqual(resumed.body.task.input, task.input);
  return {
    kind: "retried_after_restart",
    at: new Date().toISOString(),
    taskId: task.id,
    savedFailure: task.failure,
    inputUnchanged: true,
  };
}
