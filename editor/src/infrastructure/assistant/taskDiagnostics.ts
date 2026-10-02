import { AssistantServiceError } from "../../domain/assistant/failure";
import { AssistantTaskError, type AssistantTaskTrace } from "../../domain/assistant/taskDiagnostics";

export function assistantFailureReason(error: unknown): string {
  if (error instanceof AssistantTaskError) return error.reason;
  if (error instanceof AssistantServiceError) return `http_${error.status}`;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  return "validation_or_execution_failed";
}

/** Local, bounded traces make failed runs inspectable without logging private inputs. */
export function createAssistantTrace() {
  const started = performance.now();
  let entries = 0;
  return (event: AssistantTaskTrace) => {
    if (++entries > 100) return;
    console.info("[native-assistant]", JSON.stringify({ ...event,
      elapsedMs: Math.round(performance.now() - started) }));
  };
}
