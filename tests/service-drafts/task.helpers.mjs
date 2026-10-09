import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expectStatus, path } from "../assistant-task-server/helpers.mjs";
export async function create(f, content = {}, mode = "edit") {
  const project = await f.project();
  expectStatus(project, 200);
  const created = await f.request("/api/services", {
    body: {
      actionId: randomUUID(),
      projectId: project.body.project.id,
      description: "Shared draft",
    },
  });
  expectStatus(created, 200);
  const draft = created.body.draft;
  const draftPath = `/api/services/${draft.identity.serviceId}/draft`;
  const edited = await f.request(draftPath, {
    body: {
      actionId: randomUUID(),
      expectedRevision: 0,
      content: {
        ...draft.content,
        files: [{ path: "src/main.mjs", content: "// my manual code" }],
        ...content,
      },
    },
  });
  expectStatus(edited, 200);
  const taskInput = {
    operationId: randomUUID(),
    request: "Add a helpful comment and preserve my code",
    context: {
      fingerprint: `draft-${draft.identity.serviceId}-1`,
      container: { serviceId: draft.identity.serviceId, revision: 1, mode },
    },
  };
  const result = await f.create(draft.identity.projectId, taskInput);
  expectStatus(result, 201);
  return {
    task: result.body.task,
    draftPath,
    taskInput,
    draft: edited.body.draft,
  };
}
export async function until(f, task, predicate) {
  let result;
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    result = await f.request(path(task));
    expectStatus(result, 200);
    if (predicate(result.body.task)) return result.body.task;
    await delay(20);
  }
  assert.fail(JSON.stringify(result?.body));
}
