import { setTimeout as delay } from "node:timers/promises";
import {
  isTransientInferenceFailure,
  inferenceRetryDelay,
} from "../../../packages/pvo-assistant/tasks/index.js";

/** Mirror the actual saved retry policy without hiding an attempt or changing its input. */
export async function recordInferenceRetry(error, row, failures, save) {
  if (!isTransientInferenceFailure(error)) return false;
  const retryMs = inferenceRetryDelay(failures);
  row.inferenceRetries ??= [];
  row.inferenceRetries.push({
    afterAttempt: row.attempts.length,
    at: new Date().toISOString(),
    status: error.status ?? null,
    name: error.name,
    retryMs,
  });
  await save();
  if (retryMs === null) return false;
  await delay(retryMs);
  return true;
}
