import { sanitizeDiagnosticText, sanitizeDiagnosticUrl } from "../../../../packages/pvo-sdk/index.js";
import type { DebugRun } from "./types";

/** Reports deliberately omit captured values, bodies, free-form labels and exception messages. */
export function buildReport(run: DebugRun | null, elapsedMs = run?.elapsedMs ?? 0): string {
  if (!run) return "No Try run recorded.";
  return JSON.stringify({
    format: "pvo-try-debug/1", build: run.build, run: run.id, status: run.status,
    durationMs: elapsedMs, discarded: run.discarded,
    componentOverflow: run.componentOverflow, requestOverflow: run.requestOverflow,
    pendingRequests: run.pendingRequests,
    components: run.components.map(component => ({ id: component.id, type: component.type,
      sceneId: component.sceneId, at: component.at, end: component.end, dispatch: component.dispatch,
      unanswered: component.unanswered, source: component.source })),
    records: run.records.map(record => ({
      sequence: record.sequence, type: record.type, elapsedMs: record.elapsedMs,
      videoTime: record.videoTime, sceneId: record.sceneId, componentId: record.componentId,
      interactionId: record.interactionId, actionId: record.actionId, parentActionId: record.parentActionId,
      requestId: record.requestId, reason: record.reason ? sanitizeDiagnosticText(record.reason) : undefined,
      status: record.status, method: record.method, url: record.url ? sanitizeDiagnosticUrl(record.url) : undefined,
      durationMs: record.durationMs, path: record.path ? sanitizeDiagnosticText(record.path) : undefined, source: record.source,
    })),
  }, null, 2);
}
