import { saved, path, expectStatus } from "./helpers.mjs";
export const source =
  "export default { async fetch(request) { return Response.json({ answer: (await request.json()).value * 2 }); } };";
export const guard = (task) => ({
  expectedRevision: task.revision,
  claim: { id: task.claim.id, generation: task.generation },
});
export async function publishing(fixture) {
  let task = await saved(fixture);
  for (const command of [
    { kind: "claim", claimId: "planner", leaseMs: 60000 },
    { kind: "checkpoint", stepId: "publish" },
    { kind: "claim", claimId: "publisher", leaseMs: 60000 },
  ]) {
    const response = await fixture.control({
      action: "step",
      id: task.id,
      command,
    });
    expectStatus(response, 200);
    task = response.body;
  }
  return task;
}
export const publish = (fixture, task) =>
  fixture.control({
    action: "publish",
    id: task.id,
    source,
    guard: guard(task),
  });
export const current = async (fixture, task) =>
  (await fixture.request(path(task))).body.task;
export const stats = async (fixture, row) =>
  (await fixture.control({ action: "provider-status", identity: row.identity }))
    .body;
export const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
