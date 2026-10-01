import { debugTime, reasonExplanation, recordResult, resultLabel, stageFor } from "./copy";
import type { DebugGroup, DebugReadiness, DebugRecord, DebugRun, DebugStateRow, DebugStatus } from "./types";

export function diagnosticGroupId(record: Pick<DebugRecord, "interactionId" | "componentId" | "type" | "id">): string {
  if (record.interactionId) return record.interactionId;
  if (record.type.startsWith("component.")) return `component:${record.componentId ?? record.id}`;
  return record.id;
}

export function groupInteractions(run: DebugRun | null): DebugGroup[] {
  if (!run) return [];
  const groups = new Map<string, DebugGroup>();
  for (const record of run.records) {
    // Readiness is inspectable without creating a fresh activity card for every ready component.
    if (record.type === "component.ready" || record.type === "component.active" || record.type === "component.inactive") continue;
    // SDK action selection is the useful boundary; low-level media observations belong in current status.
    if (record.type.startsWith("media.") && record.type !== "media.play_rejected" && record.type !== "media.error") continue;
    const id = diagnosticGroupId(record);
    let group = groups.get(id);
    if (!group) {
      const component = run.components.find(item => item.id === record.componentId);
      group = {
        id, kind: record.interactionId ? "interaction" : record.type.startsWith("session.") ? "session"
          : record.type.startsWith("component.") ? "component" : "playback",
        componentId: record.componentId, componentName: component?.name ?? "Playback", target: record.target,
        videoTime: record.videoTime, result: "done", resultLabel: "Done", summary: "", why: "",
        stages: [], records: [], source: record.source ?? component?.source, lastSequence: record.sequence,
      };
      groups.set(id, group);
    }
    group.records.push(record);
    group.stages.push(stageFor(record));
    group.lastSequence = record.sequence;
    if (record.target) group.target = record.target;
    if (record.waitUntil != null) group.waitUntil = record.waitUntil;
    const next = recordResult(record);
    const existingFailure = ["failed", "unavailable", "no_action", "blocked"].includes(group.result);
    const incomingFailure = next != null && ["failed", "unavailable", "no_action", "blocked"].includes(next);
    const moreSpecificFailure = incomingFailure && (["unavailable", "blocked"].includes(next!) || record.status !== undefined || record.failure !== undefined);
    if (next && (!existingFailure || moreSpecificFailure)) {
      group.result = next;
      group.resultLabel = resultLabel(next, record);
      group.why = reasonExplanation(record);
      group.summary = group.why || stageFor(record).label;
    }
    if (record.type === "action.skipped" && record.reason === "no_error_route") group.nextStep = "Answer again to retry, or stop and check the request in Logic.";
  }
  for (const group of groups.values()) {
    if (group.result === "held" && group.componentId !== run.playback.holdingId) {
      group.result = "done"; group.resultLabel = "Released";
    }
    if (run.status !== "running" && ["running", "waiting", "held"].includes(group.result)) {
      group.result = "cancelled"; group.resultLabel = "Stopped";
    }
    if (!group.summary) group.summary = group.stages.at(-1)?.label ?? "";
    if (!group.why) group.why = group.summary;
    if (group.result === "waiting" && group.waitUntil != null)
      group.stages.push({ id: `${group.id}:next`, kind: "next", videoTime: group.waitUntil, label: "Action runs at layer end" });
  }
  return [...groups.values()];
}

export const errorCount = (groups: readonly DebugGroup[]) => groups.filter(group => ["failed", "unavailable", "no_action", "blocked"].includes(group.result)).length;
export const issueCount = (groups: readonly DebugGroup[]) => groups.filter(group => ["failed", "unavailable", "no_action", "blocked", "ignored"].includes(group.result)).length;

export function filterGroups(groups: readonly DebugGroup[], filter: { componentId: string; issuesOnly: boolean }): DebugGroup[] {
  return groups.filter(group => (filter.componentId === "all" || group.componentId === filter.componentId)
    && (!filter.issuesOnly || issueCount([group]) > 0));
}

export function requestRows(run: DebugRun | null) { return run?.requests ?? []; }

/** `now` uses the collector's monotonic clock, not wall time or video time. */
export function deriveStatus(run: DebugRun | null, now = (run?.clockOriginMs ?? 0) + (run?.elapsedMs ?? 0)): DebugStatus {
  const playback = run?.playback;
  const base = { sceneName: playback?.sceneName ?? "", videoTime: playback?.videoTime ?? 0,
    requestsRunning: 0, requestElapsed: 0 };
  if (!run || !playback) return { ...base, state: "stopped", title: "No Try run yet" };
  const pending = run.requests.filter(request => request.result === "running");
  base.requestsRunning = run.pendingRequests;
  base.requestElapsed = pending.length ? Math.max(0, now - run.clockOriginMs - Math.min(...pending.map(request => request.startedElapsedMs))) : 0;
  if (run.status !== "running") return { ...base, state: "stopped", title: `Last run — stopped at ${debugTime(playback.videoTime)}` };
  if (playback.observed === "error") return { ...base, state: "failed", title: "Media could not play" };
  const held = run.components.find(component => component.id === playback.holdingId);
  if (held && playback.observed !== "playing") {
    const latestRequest = [...run.requests].reverse().find(request => request.componentId === held.id && request.groupId === playback.holdInteractionId);
    const failed = latestRequest !== undefined && ["failed", "blocked"].includes(latestRequest.result);
    const prefix = playback.observed === "paused" || playback.observed === "ended" ? "Paused" : "Playback held";
    return { ...base, state: failed ? "failed" : "held", title: failed ? `${prefix} — ${held.name} request failed` : `${prefix} — waiting for ${held.name}`, holdComponentId: held.id };
  }
  if (playback.observed === "playing") {
    const waiting = groupInteractions(run).reverse().find(group => group.result === "waiting");
    return { ...base, state: "playing", title: "Playing", sub: waiting ? `${waiting.componentName} action waits for ${debugTime(waiting.waitUntil ?? 0)}` : "Listening for taps" };
  }
  if (playback.requested === "playing") return { ...base, state: "waiting", title: "Waiting for media" };
  return { ...base, state: "paused", title: "Paused" };
}

export function componentReadiness(run: DebugRun | null): DebugReadiness[] {
  if (!run) return [];
  return run.components.map(component => {
    const active = component.sceneId === run.playback.sceneId && (run.playback.holdingId === component.id
      || run.playback.videoTime >= component.at && run.playback.videoTime < component.end);
    const pending = run.requests.some(request => request.componentId === component.id && request.result === "running");
    const alreadyRun = component.dispatched || component.handled && run.playback.holdingId !== component.id;
    const lastInput = [...run.records].reverse().find(record => record.componentId === component.id && record.type === "interaction.received");
    const interactive = active && run.status === "running" && component.ready && !component.unavailable && !pending && !alreadyRun && component.type !== "tooltip";
    return { ...component, status: component.unavailable ? "unavailable" : active ? "active" : run.playback.videoTime >= component.end && component.sceneId === run.playback.sceneId ? "ended" : "ready",
      interactive, interactiveLabel: pending ? "Ignoring presses · request running" : !active ? "No · not on screen now"
        : component.type === "tooltip" ? "Display-only Note" : alreadyRun ? "Ignoring presses · answer already ran"
          : run.status !== "running" ? "No · Try stopped" : interactive ? "Yes · ready for input" : "No · component is not ready",
      lastInput: lastInput ? { videoTime: lastInput.videoTime, target: lastInput.target } : undefined };
  });
}

export function stateRows(run: DebugRun | null): DebugStateRow[] {
  if (!run) return [];
  const rows: DebugStateRow[] = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (rows.length >= 150) return;
    if (value && typeof value === "object" && depth < 4 && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key, depth + 1);
      return;
    }
    const change = [...run.records].reverse().find(record => record.type === "state.changed" && record.path === path);
    const displayValue = typeof value === "string" ? value : JSON.stringify(value) ?? "—";
    rows.push({ path, value, displayValue, masked: /\[(?:private|limited|unavailable|circular|unset)\]|redacted|masked|•••/i.test(displayValue), changedAt: change?.videoTime, before: change?.before });
  };
  visit(run.currentState, "", 0);
  return rows;
}
