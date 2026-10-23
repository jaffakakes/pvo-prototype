import { expectStatus, saved } from "./helpers.mjs";
import { guard, current } from "./provider.helpers.mjs";
export { guard, current, deferred } from "./provider.helpers.mjs";
export { files, command } from "../assistant-workspaces/helpers.mjs";

export async function building(fixture) {
  let task = await saved(fixture);
  for (const command of [
    { kind: "claim", claimId: "planner", leaseMs: 60000 },
    { kind: "checkpoint", stepId: "build" },
    { kind: "claim", claimId: "builder", leaseMs: 60000 },
  ]) {
    const result = await fixture.control({
      action: "step",
      id: task.id,
      command,
    });
    expectStatus(result, 200);
    task = result.body;
  }
  return task;
}
export async function operate(fixture, task, kind, request) {
  return fixture.control({
    action: "workspace",
    id: task.id,
    kind,
    request,
    guard: guard(await current(fixture, task)),
  });
}
export async function rows(fixture) {
  const response = await fixture.control({ action: "workspace-rows" });
  expectStatus(response, 200);
  return response.body;
}
export async function reconcile(fixture) {
  const response = await fixture.control({ action: "workspace-reconcile" });
  expectStatus(response, 200);
  return response.body;
}
export async function status(fixture, identity) {
  const response = await fixture.control({
    action: "workspace-status",
    identity,
  });
  expectStatus(response, 200);
  return response.body;
}
export async function prepare(fixture, task, files) {
  const save = await operate(fixture, task, "save", {
    id: "save",
    expectedRevision: 0,
    files,
  });
  expectStatus(save, 200);
  const reference = save.body.receipt.result;
  const start = await operate(fixture, task, "start", {
    id: "start",
    ...reference,
  });
  expectStatus(start, 200);
  return { reference, identity: save.body.identity };
}
