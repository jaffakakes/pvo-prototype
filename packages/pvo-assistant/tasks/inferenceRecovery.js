const RETRY_DELAYS_MS = [10000, 30000];

/** Retry only an unavailable read-only model request, never a rejected decision or host effect. */
export function isTransientInferenceFailure(error) {
  return (
    [500, 502, 503, 504].includes(error?.status) ||
    error?.name === "TimeoutError"
  );
}

/** Two automatic retries per consecutive failure streak, not a saved-goal request limit. */
export function inferenceRetryDelay(failures) {
  return Number.isSafeInteger(failures) && failures > 0
    ? (RETRY_DELAYS_MS[failures - 1] ?? null)
    : null;
}

/** Count only immediately preceding failed inferences for the same saved input. */
export function precedingInferenceFailures(operations, current) {
  let failures = 0;
  for (let index = operations.length - 1; index >= 0; index--) {
    const operation = operations[index];
    if (operation.id === current.id || !operation.id.startsWith("inference-"))
      continue;
    if (
      operation.inputDigest !== current.inputDigest ||
      operation.status !== "failed" ||
      !["provider_unavailable", "interrupted"].includes(operation.failure?.code)
    )
      break;
    failures++;
  }
  return failures;
}
