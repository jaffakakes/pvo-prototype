import type { DebugRecord, DebugResult, DebugStage } from "./types";

export function debugTime(time: number): string {
  const seconds = Math.max(0, Math.floor(time));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function recordResult(record: DebugRecord): DebugResult | null {
  if (record.type === "component.no_action") return "no_action";
  if (record.type === "request.rejected") return "blocked";
  if (record.type === "interaction.ignored") return record.reason === "no_matching_rule" ? "no_action" : "ignored";
  if (record.type === "action.skipped" && record.reason !== "no_error_route") return "ignored";
  if (record.type === "component.failed" || record.type === "component.unavailable") return "unavailable";
  if (record.type.endsWith(".failed") || record.type === "media.play_rejected" || record.type === "media.error" || record.type === "playback.route_failed") return "failed";
  if (record.type.endsWith(".cancelled")) return "cancelled";
  if (record.type === "playback.hold") return "held";
  if (record.type === "response.deferred") return "waiting";
  if (record.type.endsWith(".started") && record.type !== "session.started") return "running";
  if (record.type === "session.stopped") return "stopped";
  if (record.type.endsWith(".completed") || record.type === "playback.released" || record.type === "component.ready") return "done";
  return null;
}

export function resultLabel(result: DebugResult, record?: DebugRecord): string {
  if (result === "failed" && record?.status) return `Failed · ${record.status}`;
  if (result === "failed" && record?.failure?.kind === "timeout") return "Timed out";
  if (result === "failed" && record?.failure?.kind === "network") return "No response";
  if (result === "waiting" && record?.waitUntil != null) return `Waiting · ${debugTime(record.waitUntil)}`;
  return { done: "Done", failed: "Failed", unavailable: "Unavailable", no_action: "No action", blocked: "Blocked", held: "Held · no answer", waiting: "Waiting", running: "Running", ignored: "Ignored", cancelled: "Cancelled", stopped: "Stopped" }[result];
}

export function reasonExplanation(record: DebugRecord): string {
  const reason = record.reason ?? record.failure?.kind;
  const reasons: Record<string, string> = {
    layer_end: `Its action waits until the layer ends${record.waitUntil != null ? ` at ${debugTime(record.waitUntil)}` : ""}.`,
    request_pending: "A request from this component is still running, so this press was ignored.",
    already_handled: "This answer already ran in this pass through the video.",
    already_dispatched: "This answer has already been handed to Logic.",
    inactive_component: "Its component is no longer active in this scene.",
    no_matching_rule: "No Logic rule matches this control, so nothing ran.",
    invalid_control: "The component sent a control that does not exist in its current source.",
    awaiting_answer: "Playback is waiting for a viewer to answer this component.",
    awaiting_request: "Playback reached the end while a request was still running.",
    other_component_holding: "Another component still owns the playback hold.",
    no_error_route: "No error route is assigned. The component remains available to retry.",
    condition_false: "Its condition was false, so this action did not run.",
    no_matching_branch: "No branch matched and no fallback action was assigned.",
    empty_scene: "The requested destination has no playable content.",
    try_stopped: "Try stopped. Pending work was cancelled; a server may already have received it.",
    scene_changed: "The scene changed, so this pending interaction was cancelled.",
    seek: "Playback moved to another time, so this pending interaction was cancelled.",
    superseded: "A newer response replaced this one before it ran.",
    timeout: "No response arrived before the deadline. The server may still have received the request.",
    network: "No HTTP status came back, and the browser does not say why. This alone does not show whether the server is down.",
    policy: "The request was rejected by PVO's destination policy before it was sent.",
    play_rejected: "The editor asked the video to play, but the browser did not start it.",
    start_error: "The component could not start. Its rendering or source validation failed.",
    not_ready: "The component's isolated runtime is not ready to receive this input.",
    queue_full: "The component already has too many inputs waiting to run.",
    invalid_fields: "The form has a field that needs correcting before it can be submitted.",
    rate_limit: "The component reached its action rate limit.",
    action_too_large: "The component action exceeds the allowed size.",
    invalid_request: "The component supplied an invalid request configuration.",
    invalid_action: "The selected action could not be prepared or completed.",
    missing_destination: "This form needs a request destination before it can submit.",
    invalid_form: "The form configuration or submitted values could not be validated.",
    interaction_cancelled: "This interaction was cancelled before it finished.",
  };
  if (record.status === 404) return "The server answered, but did not find the requested address (404).";
  if (record.status && record.status >= 400) return `The server answered with HTTP ${record.status}.`;
  return reasons[reason ?? ""] ?? record.failure?.message ?? record.label ?? "";
}

export function stageFor(record: DebugRecord): DebugStage {
  const labels: Record<string, string> = {
    "session.started": "Try started", "session.stopped": "Try stopped", "session.failed": "Try could not continue",
    "interaction.received": "Click received", "interaction.accepted": "Answer recorded",
    "interaction.ignored": record.reason === "no_matching_rule" ? "No action assigned" : "Press ignored",
    "response.deferred": "Waiting for the layer to end", "action.selected": "Logic rule selected",
    "action.started": "Action started", "action.completed": "Action completed", "action.failed": "Action failed",
    "action.skipped": record.reason === "no_error_route" ? "No error route" : "Action skipped", "action.cancelled": "Action cancelled",
    "request.started": `${record.method ?? "GET"} request started`,
    "request.completed": record.status ? `Server returned ${record.status}` : "Response received",
    "request.failed": record.status ? `Server returned ${record.status}` : record.failure?.kind === "timeout" ? "Request timed out" : "No response",
    "request.rejected": "Request blocked", "request.cancelled": "Request cancelled",
    "state.changed": `State changed: ${record.path ?? "value"}`,
    "playback.hold": "Playback held", "playback.released": "Playback hold released",
    "playback.seek_requested": "Seek requested", "playback.scene_requested": "Scene change requested",
    "playback.route_failed": "Playback route could not run", "media.play_rejected": "Video did not start",
    "media.play_requested": "Playback requested", "media.playing": "Video is playing", "media.paused": "Video paused",
    "media.waiting": "Waiting for media", "media.seeking": "Video is seeking", "media.ended": "Video ended", "media.error": "Media could not play",
    "component.ready": "Component ready", "component.failed": "Failed to start", "component.unavailable": "Marked unavailable", "component.no_action": "No action assigned",
    "component.active": "Component became active", "component.inactive": "Component is no longer active",
  };
  const result = recordResult(record);
  const kind = result === "failed" || result === "unavailable" ? "fail" : result === "blocked" || result === "no_action" ? "warn"
    : result === "ignored" || result === "cancelled" ? "ignored" : result === "waiting" || result === "held" ? "wait" : result === "running" ? "running" : "ok";
  return { id: record.id, kind, videoTime: record.videoTime, label: labels[record.type] ?? record.type.replaceAll(".", " "), detail: reasonExplanation(record) || undefined, reason: record.reason };
}
