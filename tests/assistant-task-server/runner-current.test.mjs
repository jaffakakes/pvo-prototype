import assert from "node:assert/strict";
import test from "node:test";
import { runAuthoringStep } from "../../server/assistant/tasks/runner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";

test("a committed Stop fences dispatch and late preparation before its cancellation signal is delivered", async () => {
  for (const stoppedAt of ["dispatch", "reply"]) {
    const claimed = claim(create());
    let current = true;
    let calls = 0;
    let preparationReads = 0;
    let receipt;
    const coordinator = {
      active: new Map(),
      accountConnections: { expire: () => {} },
      repairs: { context: () => null },
      progress: { context: () => [], question: () => null },
      research: { sql: { exec: () => ({ toArray: () => [] }) } },
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
          if (stoppedAt === "dispatch") current = false;
          return true;
        },
        current: () => current,
        task: () => claimed,
        finish(_claimed, attempt, command, code) {
          receipt = { attempt, command, code };
        },
      },
      async plan() {
        calls++;
        current = false; // Stop commits while inference finishes; no abort signal yet.
        return {
          get kind() {
            preparationReads++;
            return "checkpoint";
          },
          stepId: "plan",
        };
      },
    };
    await runAuthoringStep(coordinator, claimed);
    assert.equal(calls, stoppedAt === "dispatch" ? 0 : 1);
    assert.equal(preparationReads, 0);
    assert.equal(receipt.command, null);
    assert.equal(receipt.code, "interrupted");
    assert.equal(
      receipt.attempt.dispatched,
      stoppedAt === "reply",
      "Only an actually dispatched inference consumes its reservation",
    );
    assert.equal(coordinator.active.size, 0);
  }
});
