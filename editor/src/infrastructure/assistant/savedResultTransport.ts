import { matchPreparedTaskResult } from "../../../../packages/pvo-assistant/results/index.js";
import {
  parseTaskRecord,
  TASK_LIMITS,
  type TaskRecord,
} from "../../../../packages/pvo-assistant/tasks/index.js";
import { readAssistantBytes } from "./serviceResponse";
import { SavedTaskHttpError } from "./savedTaskTransport";

/** Read only the fixed owned route and verify the immutable bytes before interpreting source. */
export async function readSavedResult(value: TaskRecord, signal: AbortSignal) {
  const task = parseTaskRecord(value);
  if (task.state !== "ready" || !task.result)
    throw new Error("This task has no prepared result yet.");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  combined.throwIfAborted();
  const response = await fetch(`/api/assistant/tasks/${task.id}/result`, {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: combined,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SavedTaskHttpError(response.status);
  }
  const bytes = await readAssistantBytes(
    response,
    combined,
    TASK_LIMITS.artifactBytes,
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  combined.throwIfAborted();
  const digest = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    bytes.byteLength !== task.result.artifact.bytes ||
    digest !== task.result.artifact.sha256
  )
    throw new Error(
      "The saved result did not match its receipt. Retry to download it again.",
    );
  return matchPreparedTaskResult(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    task,
  );
}
