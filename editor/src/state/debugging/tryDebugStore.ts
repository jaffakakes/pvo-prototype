import { create } from "zustand";
import { sanitizeDiagnosticText, sanitizeDiagnosticValue, type PvoDiagnosticEvent } from "../../../../packages/pvo-sdk/index.js";
import { snapshotDebugComponents } from "../../domain/debugging/components";
import { buildReport } from "../../domain/debugging/report";
import { diagnosticGroupId, groupInteractions } from "../../domain/debugging/selectors";
import { updateDebugRequests } from "../../domain/debugging/requests";
import type { DebugPlayback, DebugRecord, DebugRun } from "../../domain/debugging/types";
import type { Scene } from "../../domain/project/model";

declare const __APP_BUILD__: string | undefined;

export type DebugRunInput = {
  projectId: string | null;
  scenes: readonly Scene[];
  sceneId: string;
  videoTime: number;
  requested: boolean;
  handledIds?: readonly string[];
  dispatchedIds?: readonly string[];
};
export type DebugLocation = { sceneId: string; sceneName: string; videoTime: number };
export const useTryDebugStore = create<{ run: DebugRun | null; captureData: boolean }>(() => ({ run: null, captureData: false }));
let serial = 0;
let sequence = 0;
const MAX_RECORDS = 700;
const MAX_BYTES = 350_000;
export const debugClockNow = () => globalThis.performance?.now() ?? Date.now();
const elapsed = (run: DebugRun) => Math.max(run.elapsedMs, debugClockNow() - run.clockOriginMs);

function safe<T>(operation: () => T, fallback: T): T {
  try { return operation(); } catch { return fallback; }
}

export function startDebugRun(input: DebugRunInput): string {
  return safe(() => {
    const id = `try-${++serial}`;
    sequence = 0;
    const playback: DebugPlayback = { clock: "unknown", sceneId: input.sceneId, sceneName: input.scenes.find(scene => scene.id === input.sceneId)?.name ?? "Scene",
      videoTime: input.videoTime, requested: input.requested ? "playing" : "paused", observed: "unknown", holdingId: null, holdInteractionId: null, holdReason: null };
    const components = snapshotDebugComponents(input.scenes);
    useTryDebugStore.setState({ captureData: false, run: { id, projectId: input.projectId,
      build: typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "development", startedAt: Date.now(), clockOriginMs: debugClockNow(), elapsedMs: 0, status: "running",
      records: [], components: components.slice(0, 400), currentState: {}, playback, requests: [], discarded: 0,
      pendingRequests: 0, requestOverflow: 0, componentOverflow: Math.max(0, components.length - 400) } });
    recordDebugEvent(id, { type: "session.started" });
    for (const component of useTryDebugStore.getState().run?.components ?? []) {
      if (component.unavailable) recordDebugEvent(id, { type: "component.unavailable", componentId: component.id, sceneId: component.sceneId, reason: "start_error", source: component.source });
      else if (component.actionKnown && !component.hasAction && component.type !== "tooltip") recordDebugEvent(id, { type: "component.no_action", componentId: component.id, sceneId: component.sceneId, reason: "no_matching_rule", source: component.source });
    }
    return id;
  }, "");
}

export function recordDebugEvent(runId: string, event: PvoDiagnosticEvent, location?: DebugLocation): void {
  safe(() => {
    const state = useTryDebugStore.getState();
    const run = state.run;
    if (!run || run.id !== runId || run.status !== "running") return;
    const record: DebugRecord = { ...event, id: `${runId}:${++sequence}`, runId, sequence,
      elapsedMs: elapsed(run), videoTime: location?.videoTime ?? run.playback.videoTime,
      sceneId: event.sceneId ?? location?.sceneId ?? run.playback.sceneId,
      ...(event.message ? { message: sanitizeDiagnosticText(event.message) } : {}),
      ...(event.label ? { label: sanitizeDiagnosticText(event.label).slice(0, 160) } : {}),
      ...(event.target ? { target: sanitizeDiagnosticText(event.target).slice(0, 100) } : {}),
    };
    const requests = updateDebugRequests(run.requests, record, run.components);
    // Count a new attempt once; a terminal event for an already omitted request is not a new omission.
    const newAttempt = record.type === "request.started" || record.type === "request.rejected";
    const requestOverflow = run.requestOverflow + (newAttempt && record.requestId && !run.requests.some(row => row.id === record.requestId) && run.requests.length >= 200 ? 1 : 0);
    const pendingRequests = Math.max(0, run.pendingRequests + (record.type === "request.started" ? 1
      : ["request.completed", "request.failed", "request.cancelled"].includes(record.type) ? -1 : 0));
    let records = [...run.records, record];
    let discarded = run.discarded;
    const pendingGroups = new Set(requests.filter(request => request.result === "running").map(request => request.groupId));
    while (records.length > MAX_RECORDS || JSON.stringify(records).length > MAX_BYTES) {
      const index = records.findIndex(item => item.type !== "session.started" && !pendingGroups.has(diagnosticGroupId(item)));
      records.splice(index < 0 ? 0 : index, 1);
      discarded += 1;
    }
    let components = run.components;
    if (event.componentId && event.type.startsWith("component.")) components = components.map(component => component.id !== event.componentId ? component : {
      ...component, ready: event.type === "component.ready" ? true : component.ready,
      actionKnown: event.type === "component.ready" && ["action_assigned", "no_matching_rule"].includes(event.reason ?? "") ? true : component.actionKnown,
      hasAction: event.type === "component.ready" && event.reason === "action_assigned" ? true
        : event.type === "component.no_action" || event.type === "component.ready" && event.reason === "no_matching_rule" ? false : component.hasAction,
      unavailable: event.type === "component.failed" || event.type === "component.unavailable" ? true : event.type === "component.ready" ? false : component.unavailable,
      failure: record.message ?? component.failure,
    });
    const observed: Partial<Record<string, DebugPlayback["observed"]>> = {
      "media.playing": "playing", "media.paused": "paused", "media.waiting": "waiting", "media.seeking": "seeking",
      "media.ended": "ended", "media.error": "error", "media.play_rejected": "waiting",
    };
    const playback = { ...run.playback,
      ...(event.type.startsWith("media.") ? { clock: event.reason === "timeline_clock" ? "timeline" as const : "media" as const } : {}),
      ...(observed[event.type] ? { observed: observed[event.type]! } : {}),
      ...(event.type === "playback.hold" ? { holdingId: event.componentId ?? null,
        holdInteractionId: event.reason === "awaiting_answer" ? null : event.interactionId ?? null, holdReason: event.reason ?? null } : {}),
      ...(["interaction.accepted", "request.started"].includes(event.type) && event.componentId === run.playback.holdingId
        ? { holdInteractionId: event.interactionId ?? null } : {}),
      ...(event.type === "playback.released" ? { holdingId: null, holdInteractionId: null, holdReason: null } : {}),
    };
    useTryDebugStore.setState({ run: { ...run, elapsedMs: record.elapsedMs, records, discarded, components, playback, requests, pendingRequests, requestOverflow } });
  }, undefined);
}

export function stopDebugRun(runId: string, reason = "try_stopped", failed = false): void {
  safe(() => {
    const run = useTryDebugStore.getState().run;
    if (!run || run.id !== runId || run.status !== "running") return;
    for (const request of run.requests.filter(row => row.result === "running")) recordDebugEvent(runId, {
      type: "request.cancelled", requestId: request.id, interactionId: request.groupId,
      componentId: request.componentId, method: request.method, url: request.url, reason,
      durationMs: Math.max(0, elapsed(run) - request.startedElapsedMs),
    });
    recordDebugEvent(runId, { type: failed ? "session.failed" : "session.stopped", reason });
    useTryDebugStore.setState(state => state.run?.id === runId ? {
      captureData: false, run: { ...state.run, endedAt: Date.now(), status: failed ? "failed" : "stopped", pendingRequests: 0 },
    } : {});
  }, undefined);
}

export function publishDebugState(runId: string, value: Record<string, unknown>): void {
  safe(() => {
    const run = useTryDebugStore.getState().run;
    if (!run || run.id !== runId || run.status !== "running") return;
    const currentState = sanitizeDiagnosticValue(value);
    useTryDebugStore.setState({ run: { ...run, currentState: currentState && typeof currentState === "object" && !Array.isArray(currentState) ? currentState : {} } });
  }, undefined);
}

export function syncDebugContext(input: DebugRunInput & { holdingId: string | null }, updateSources = false): void {
  safe(() => {
    const run = useTryDebugStore.getState().run;
    if (!run) return;
    if (run.projectId !== input.projectId) { useTryDebugStore.setState({ run: null, captureData: false }); return; }
    const fresh = updateSources ? snapshotDebugComponents(input.scenes) : null;
    const components = run.components.map(component => ({ ...component,
      ...(fresh ? { currentRevision: fresh.find(item => item.id === component.id)?.currentRevision ?? "removed" } : {}),
      ...(run.status === "running" ? { handled: input.handledIds?.includes(component.id) ?? false, dispatched: input.dispatchedIds?.includes(component.id) ?? false } : {}),
    }));
    const playback = run.status === "running" ? { ...run.playback,
      sceneId: input.sceneId, sceneName: input.scenes.find(scene => scene.id === input.sceneId)?.name ?? "Scene",
      videoTime: input.videoTime, requested: input.requested ? "playing" as const : "paused" as const,
      ...(run.playback.clock === "timeline" && !input.requested ? { observed: "paused" as const } : {}),
      holdingId: input.holdingId, holdReason: input.holdingId ? run.playback.holdReason : null,
      holdInteractionId: input.holdingId ? run.playback.holdInteractionId : null,
    } : run.playback;
    useTryDebugStore.setState({ run: { ...run, components, playback, elapsedMs: run.status === "running" ? elapsed(run) : run.elapsedMs } });
  }, undefined);
}

export function setDebugCaptureData(value: boolean): void {
  useTryDebugStore.setState(state => ({ captureData: state.run?.status === "running" && value }));
}

export function clearCompletedDebugActivity(): number {
  return safe(() => {
    const run = useTryDebugStore.getState().run;
    if (!run) return 0;
    const protectedGroups = new Set(run.requests.filter(request => request.result === "running").map(request => request.groupId));
    if (run.status === "running" && run.playback.holdingId && run.playback.holdInteractionId)
      protectedGroups.add(run.playback.holdInteractionId);
    const completed = new Set(groupInteractions(run).filter(group => group.kind !== "session"
      && !protectedGroups.has(group.id) && !["running", "waiting", "held"].includes(group.result)).map(group => group.id));
    useTryDebugStore.setState({ run: { ...run,
      records: run.records.filter(record => !completed.has(diagnosticGroupId(record))),
      requests: run.requests.filter(request => request.result === "running" || protectedGroups.has(request.groupId)),
    } });
    return completed.size;
  }, 0);
}

export function buildDebugReport(): string {
  const run = useTryDebugStore.getState().run;
  return buildReport(run, run?.status === "running" ? elapsed(run) : run?.elapsedMs);
}
