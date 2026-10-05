import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { dinnerAgreement, packageFor, dinnerSource } from "./fixtures.mjs";
export {
  taskFixture,
  saved,
  path,
  expectStatus,
} from "../assistant-task-server/helpers.mjs";
export {
  current,
  deferred,
} from "../assistant-task-server/workspace.helpers.mjs";
export async function until(read, predicate) {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail(
    "Validation did not reach expected state: " + JSON.stringify(value),
  );
}
export const validation = async (f, task) =>
  (await f.control({ action: "validation-state", id: task.id })).body;
export function planner({
  repair = false,
  cases = 1,
  observe = () => {},
} = {}) {
  return async (request) => {
    const task = await request.json();
    observe(task);
    if (task.stepId === "plan")
      return Response.json({ kind: "checkpoint", stepId: "build" });
    const context = task.builderContext;
    if (!context.agreement) {
      const agreement = dinnerAgreement();
      for (let i = 1; i < cases; i++)
        agreement.cases.push({
          ...structuredClone(agreement.cases[0]),
          id: `case-${i}`,
        });
      return Response.json({ kind: "agreement", agreement });
    }
    const writes = context.feedback.filter(
      (item) => item.kind === "workspace_write",
    );
    if (
      !writes.length ||
      (repair && context.reviewFeedback && writes.length === 1)
    ) {
      const bad = repair && !writes.length;
      return Response.json({
        kind: "tools",
        calls: [
          {
            kind: "workspace_write",
            expectedRevision: writes.length,
            files: packageFor(
              bad
                ? "export function execute({state}){return {result:'full',state};}"
                : dinnerSource,
            ).files,
          },
        ],
        review: null,
      });
    }
    return Response.json({
      kind: "review",
      ...writes.at(-1).result.result,
      entrypoint: "src/service.mjs",
      tests: ["tests/service.test.mjs"],
    });
  };
}
