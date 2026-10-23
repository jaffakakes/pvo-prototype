import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

/** Wait for local test inputs chosen from the generated agreement, within this deployment's expiry. */
async function reviewedJson(file, { expiresAt, signal }) {
  while (Date.now() < expiresAt) {
    signal.throwIfAborted();
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (text !== undefined) {
      assert(Buffer.byteLength(text) <= 16384, "Test input plan is too large");
      return JSON.parse(text);
    }
    await pause(2000, undefined, { signal });
  }
  throw new Error(
    "Acceptance window ended before diagnostic input was reviewed",
  );
}

export async function reviewedInputs(file, options) {
  const plan = await reviewedJson(file, options);
  assert(
    Array.isArray(plan.resultPath) &&
      plan.resultPath.every((key) => typeof key === "string"),
  );
  assert(
    plan.testFields &&
      plan.viewerFields &&
      plan.publishedFields &&
      Object.hasOwn(plan, "publishedExpected") &&
      Array.isArray(plan.cases),
  );
  assert(Array.isArray(plan.raceInputs) && plan.raceInputs.length === 2);
  assert(Object.hasOwn(plan, "accepted") && Object.hasOwn(plan, "rejected"));
  return plan;
}

/** IDs fence a delayed local answer to exactly the question that was reviewed. */
export async function reviewedAnswer(file, { taskId, question, ...options }) {
  const answer = await reviewedJson(file, options);
  assert.equal(answer.taskId, taskId);
  assert.equal(answer.questionId, question.id);
  assert.equal(answer.questionRevision, question.revision);
  assert(
    typeof answer.value === "string" &&
      answer.value.trim() &&
      Buffer.byteLength(answer.value) <= 4000,
  );
  return answer.value;
}
