import assert from "node:assert/strict";
import test from "node:test";
import { runAuthoringStep } from "../../server/assistant/tasks/runner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";

test("a committed Stop prevents inference even before its cancellation signal is delivered", async () => {
  const claimed = claim(create());
  let current = true;
  let calls = 0;
  let receipt;
  const coordinator = {
    active: new Map(),
    repairs: { context: () => null },
    evidence: {
      context: () => ({
        archivedQuestions: 0,
        archivedOperations: 0,
        selection: null,
      }),
    },
    now: () => claimed.updatedAt,
    stepTimeoutMs: () => 1000,
    env: {
      ASSISTANT_BUDGET: {
        getByName: () => ({ reserveTask: async () => ({ accepted: true }) }),
      },
    },
    transaction: async (operation) => operation(),
    attempts: {
      begin: () => ({
        taskId: claimed.id,
        operationId: "inference",
        dispatched: false,
      }),
      dispatch(_claimed, attempt) {
        attempt.dispatched = true;
        current = false; // Stop commits while dispatch acknowledgement returns; no abort signal yet.
        return true;
      },
      current: () => current,
      finish(_claimed, attempt, command, code) {
        receipt = { attempt, command, code };
      },
    },
    async plan() {
      calls++;
      return { kind: "checkpoint", stepId: "plan" };
    },
  };
  await runAuthoringStep(coordinator, claimed);
  assert.equal(calls, 0);
  assert.equal(receipt.command, null);
  assert.equal(receipt.code, "interrupted");
  assert.equal(
    receipt.attempt.dispatched,
    false,
    "Proven unused inference capacity can be released",
  );
  assert.equal(coordinator.active.size, 0);
});
