import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
} from "../assistant-task-server/helpers.mjs";
import { guard } from "../assistant-task-server/provider.helpers.mjs";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
export { taskFixture, expectStatus };
export {
  deferred,
  current,
} from "../assistant-task-server/provider.helpers.mjs";
export async function hosted(f, { source, agreement, checked } = {}) {
  const project = await f.project();
  expectStatus(project, 200);
  const created = await f.create(project.body.project.id, {
    operationId: randomUUID(),
  });
  expectStatus(created, 201);
  let task = created.body.task;
  for (const command of [
    { kind: "claim", claimId: "setup", leaseMs: 60000 },
    { kind: "checkpoint", stepId: "host" },
    { kind: "claim", claimId: "publisher", leaseMs: 60000 },
  ]) {
    const response = await f.control({ action: "step", id: task.id, command });
    expectStatus(response, 200);
    task = response.body;
  }
  const published = await f.control({
    action: "publish",
    id: task.id,
    checked: checked ?? (await checkedFixture(source, agreement)),
    guard: guard(task),
  });
  expectStatus(published, 200);
  return { task, identity: published.body.identity };
}
export const action = (actionId, name = "Alice") => ({
  actionId,
  operation: "join",
  input: { name },
});
export const call = (f, service, body, options = {}) =>
  f.request(`/api/services/${service.identity.serviceId}/try`, {
    body,
    ...options,
  });
export const publicCall = (f, service, body) =>
  f.request(`/api/services/${service.identity.serviceId}/actions`, {
    body,
    session: null,
    headers: { Origin: "null" },
  });
export const inspect = async (f, service, kind = "inspect") =>
  (
    await f.control({
      action: "host-diagnostic",
      identity: service.identity,
      kind,
    })
  ).body;

export const status = (f, service, options = {}) =>
  f.request(`/api/services/${service.identity.serviceId}`, options);
export async function control(f, service, kind, options = {}) {
  const current = await status(f, service);
  expectStatus(current, 200);
  const body = {
    kind,
    actionId: randomUUID(),
    expectedRevision: current.body.summary.service.revision,
    ...(kind === "activate" ? { releaseId: service.identity.resourceId } : {}),
    ...options.body,
  };
  return f.request(`/api/services/${service.identity.serviceId}/${kind}`, {
    ...options,
    body,
  });
}

export async function version(
  f,
  service,
  { source, agreement, operationId = randomUUID() } = {},
) {
  const result = await f.control({
    action: "host-version",
    id: service.task.id,
    checked: await checkedFixture(source, agreement),
    operationId,
  });
  expectStatus(result, 200);
  return { ...service, identity: result.body };
}
