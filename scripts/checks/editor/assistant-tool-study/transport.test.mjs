import test from "node:test";
import assert from "node:assert/strict";
import { createStudyHandler } from "./server.mjs";
import { studyTurnEnvelope } from "./transport.mjs";
import { nativeInput } from "../../../../tests/native-assistant-server.helpers.mjs";

test("actual browser envelope passes the strict server contract without runner metadata", async () => {
  let calls = 0;
  const handler = createStudyHandler({ bank: { vision: [] }, modelsForTrial: () => ({
    textAttemptMs: 1000, generate: async () => {
      calls += 1;
      return { content: { message: "No edit requested.", answer: "The project has one scene.", operations: [], observations: [] } };
    },
  }) });
  const trial = { trialId: "case-r1-separate", pairId: "case-r1", replicate: 1, variant: "separate",
    ordinal: 1, caseId: "case", pairPosition: 1 };
  const input = { ...nativeInput(), mode: "ask", prompt: "How many scenes are there?" };
  const response = await handler(new Request("http://127.0.0.1:5199/study/turn", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(studyTurnEnvelope(trial, "frozen", input)),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2, "Normal terminal completion review still executes");
  assert.deepEqual((await response.json()).result.operations, []);
});
