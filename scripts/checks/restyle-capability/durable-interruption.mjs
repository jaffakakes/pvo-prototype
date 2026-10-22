import assert from "node:assert/strict";
import { forwardModelRequest } from "./provider.mjs";
import { path } from "../../../tests/assistant-task-server/helpers.mjs";

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

/** Restart while automatic recovery is saved; no Resume action or model correction is supplied. */
export async function restartLostInference(fixture, task) {
  assert.equal(task.state, "waiting");
  assert.equal(task.wait.reason, "model_connection");
  assert.equal(task.failure, null);
  assert.equal(task.operations[0].failure.code, "provider_unavailable");
  assert.equal(task.result, null);
  assert.equal(task.usage.modelTurns, 1);
  await fixture.restart();
  const restored = (await fixture.request(path(task))).body.task;
  assert.equal(restored.id, task.id);
  assert.deepEqual(restored.input, task.input);
  assert.equal(restored.state, "waiting");
  assert.deepEqual(restored.wait, task.wait);
  assert.equal(restored.nextRunAt, task.nextRunAt);
  assert.deepEqual(restored.operations, task.operations);
  return {
    kind: "automatic_retry_preserved_across_restart",
    at: new Date().toISOString(),
    taskId: task.id,
    savedFailure: task.operations[0].failure,
    retryAt: task.nextRunAt,
    explicitResume: false,
    inputUnchanged: true,
  };
}
