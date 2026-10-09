import { RequestTimeoutError } from "./request-failure.js";

const REQUEST_TIMEOUT_MS = 15_000;

function cancellationError(signal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The interaction was cancelled.");
  error.name = "AbortError";
  return error;
}

/** Bound both the host request and its response body, even when a host ignores abort. */
export async function withRequestDeadline(run, callerSignal, milliseconds = REQUEST_TIMEOUT_MS) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 360_000)
    throw new RangeError("The host request deadline is outside its supported range.");
  if (callerSignal?.aborted) throw cancellationError(callerSignal);

  const controller = new AbortController();
  let rejectInterruption;
  const interruption = new Promise((_, reject) => { rejectInterruption = reject; });
  const interrupt = (error) => {
    if (controller.signal.aborted) return;
    rejectInterruption(error);
    // Settle the deadline before aborting the host. An abort-reactive host can
    // reject synchronously, but the user should still see the timeout cause.
    controller.abort(error);
  };
  const onCallerAbort = () => interrupt(cancellationError(callerSignal));
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  if (callerSignal?.aborted) onCallerAbort();
  const timeout = setTimeout(() => interrupt(new RequestTimeoutError()), milliseconds);

  try {
    let operation;
    try {
      // Start the host effect in the same turn as request_start, as before.
      operation = controller.signal.aborted
        ? Promise.reject(controller.signal.reason)
        : Promise.resolve(run(controller.signal));
    } catch (error) {
      operation = Promise.reject(error);
    }
    return await Promise.race([operation, interruption]);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
