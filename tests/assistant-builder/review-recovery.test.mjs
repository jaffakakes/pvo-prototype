import assert from "node:assert/strict";
import test from "node:test";
import { runBuilderBatch } from "../../server/assistant/builder/runner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";
import { transitionTask } from "../../packages/pvo-assistant/tasks/index.js";

test("a saved completed review batch advances after restart without a seventh inference or any tool", async () => {
  const task = {
    ...claim(create()),
    stepId: "build",
    usage: {
      modelTurns: 6,
      toolCalls: 24,
      reservedModelTurns: 0,
      reservedToolCalls: 0,
    },
  };
  let result;
  const coordinator = {
    now: () => task.updatedAt,
    transaction: async (operation) => operation(),
    builders: { stage: () => "review", task: () => task },
    repository: {
      update(id, command, guard) {
        assert.equal(id, task.id);
        result = transitionTask(task, command, guard);
      },
    },
  };
  await runBuilderBatch(coordinator, task);
  assert.equal(result.stepId, "validate");
  assert.equal(result.state, "queued");
  assert.equal(result.result, null);
  assert.equal(result.usage.modelTurns, 6);
  assert.equal(result.usage.toolCalls, 24);
});
