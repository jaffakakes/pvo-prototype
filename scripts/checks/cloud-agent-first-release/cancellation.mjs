import assert from "node:assert/strict";
import { scenarioInput } from "./scenarios.js";

/** Exercise terminal Stop through the real account routes on a separate saved task. */
export async function checkCancellation(call, record, { expiresAt, signal }) {
  const api = async (path, method = "GET", body) => {
    signal?.throwIfAborted();
    assert.ok(Date.now() < expiresAt, "Cancellation check deadline ended");
    const response = await call("/dinner/api", "POST", { path, method, body });
    assert.equal(response.status, 200);
    return response.data;
  };
  const project = await api("/api/assistant/projects", "POST", {
    localId: "acceptance-stop-probe",
  });
  assert.ok([200, 201].includes(project.status));
  const input = scenarioInput("dinner", project.body.project.id);
  input.operationId = "acceptance-stop-probe";
  const created = await api("/api/assistant/tasks", "POST", input);
  assert.ok([200, 201].includes(created.status));
  let task = created.body.task;
  const path = `/api/assistant/tasks/${task.id}`;
  while (task.state !== "stopped") {
    const stopped = await api(`${path}/stop`, "POST", {
      expectedRevision: task.revision,
    });
    assert.ok([200, 409].includes(stopped.status));
    const saved = await api(path);
    assert.equal(saved.status, 200);
    task = saved.body.task;
  }
  const resumed = await api(`${path}/resume`, "POST", {
    expectedRevision: task.revision,
  });
  assert.equal(resumed.status, 409, "Stop must remain terminal");
  const saved = await api(path);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.task.id, task.id);
  assert.equal(saved.body.task.state, "stopped");
  await record("stopped_task_stays_stopped", {
    taskId: task.id,
    revision: saved.body.task.revision,
    resumeStatus: resumed.status,
  });
}
