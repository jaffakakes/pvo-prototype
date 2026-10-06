import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

/** Wait for local test inputs chosen from the generated agreement, within this deployment's expiry. */
export async function reviewedInputs(file, { expiresAt, signal }) {
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
      const plan = JSON.parse(text);
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
      assert(
        Object.hasOwn(plan, "accepted") && Object.hasOwn(plan, "rejected"),
      );
      return plan;
    }
    await pause(2000, undefined, { signal });
  }
  throw new Error(
    "Acceptance window ended before generated service inputs were reviewed",
  );
}
