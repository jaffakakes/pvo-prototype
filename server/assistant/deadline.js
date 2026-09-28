import { HttpError } from "../http.js";

/** Bound an operation even when an upstream ignores cancellation; always release owned listeners. */
export async function withAssistantDeadline(operation, milliseconds, parentSignal) {
  const controller = new AbortController();
  const timeout = new HttpError(504, "The assistant took too long. Please try again.");
  const cancelled = new HttpError(400, "The assistant request was cancelled.");
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const stop = reason => {
    controller.abort(reason);
    rejectStopped(reason);
  };
  const onAbort = () => stop(parentSignal.reason instanceof HttpError ? parentSignal.reason : cancelled);
  const timer = setTimeout(() => stop(timeout), milliseconds);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  if (parentSignal?.aborted) onAbort();
  try {
    return await Promise.race([stopped, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}
