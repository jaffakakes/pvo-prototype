import { sanitizeDiagnosticUrl } from "../../../../packages/pvo-sdk/index.js";
import { diagnosticGroupId } from "./selectors";
import { reasonExplanation, resultLabel } from "./copy";
import type { DebugComponent, DebugRecord, DebugRequestRow } from "./types";

function boundedBody(value: unknown): unknown {
  return value !== undefined && JSON.stringify(value).length > 800 ? "[limited]" : value;
}

export function updateDebugRequests(rows: readonly DebugRequestRow[], record: DebugRecord, components: readonly DebugComponent[]): DebugRequestRow[] {
  if (!record.type.startsWith("request.") || !record.requestId) return [...rows];
  const previous = rows.find(row => row.id === record.requestId);
  const url = sanitizeDiagnosticUrl(record.url ?? previous?.url ?? "");
  let host = "";
  let path = "";
  try { const parsed = new URL(url); host = parsed.host; path = parsed.pathname; } catch { /* A rejected URL need not be parseable. */ }
  const result = record.type === "request.started" ? "running" : record.type === "request.completed" ? "done"
    : record.type === "request.cancelled" ? "cancelled" : record.type === "request.rejected" ? "blocked" : "failed";
  const row: DebugRequestRow = {
    id: record.requestId, groupId: previous?.groupId ?? diagnosticGroupId(record), componentId: record.componentId,
    componentName: components.find(component => component.id === record.componentId)?.name ?? "Component",
    method: record.method ?? previous?.method ?? "GET", url, host, path,
    videoTime: previous?.videoTime ?? record.videoTime, startedElapsedMs: previous?.startedElapsedMs ?? record.elapsedMs,
    durationMs: record.durationMs ?? previous?.durationMs,
    status: record.status ?? record.failure?.status, result, resultLabel: resultLabel(result, record),
    reason: record.reason ?? record.failure?.kind, explanation: reasonExplanation(record), captured: record.captured ?? previous?.captured ?? false,
    requestBody: boundedBody(record.requestBody ?? previous?.requestBody), responseBody: boundedBody(record.responseBody ?? previous?.responseBody),
  };
  const next = previous ? rows.map(item => item.id === row.id ? row : item) : [...rows, row];
  // Completed rows can be discarded. Keep separately bounded pending request evidence.
  if (next.length <= 200) return next;
  const completed = next.findIndex(item => item.result !== "running");
  return completed >= 0 ? next.filter((_, index) => index !== completed) : next.slice(-200);
}
