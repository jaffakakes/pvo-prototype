import type { PvoDiagnosticContext, PvoDiagnosticEvent } from "../../../../packages/pvo-sdk/index.js";
import { debugTarget, sourceRevision } from "../../domain/debugging/components";
import type { ComponentResponse, PvoComponent, Scene } from "../../domain/project/model";

type Source = { localId?: string | null; scenes: Scene[]; currentSceneId: string; t: number };
export type TryDiagnosticSink = {
  start(source: Source): string;
  stop(runId: string, reason: string, failed: boolean): void;
  record(runId: string, event: PvoDiagnosticEvent, source: Source): void;
  state(runId: string, state: Record<string, unknown>): void;
  capture(): boolean;
};

/** Session-owned observation identities. No diagnostic callback can change playback. */
export function createTryDiagnostics(getState: () => Source, sink?: TryDiagnosticSink) {
  let runId = "";
  let serial = 0;
  let responses = new WeakMap<ComponentResponse, string>();
  const latest = new Map<string, string>();
  const safe = <T>(operation: () => T, fallback: T) => { try { return operation(); } catch { return fallback; } };
  const record = (event: PvoDiagnosticEvent) => safe(() => sink?.record(runId, event, getState()), undefined);
  function start(videoTime?: number) {
    responses = new WeakMap(); latest.clear(); serial = 0;
    runId = safe(() => sink?.start({ ...getState(), ...(videoTime !== undefined ? { t: videoTime } : {}) }) ?? "", "");
  }
  function source(component: PvoComponent) {
    return { revision: safe(() => sourceRevision(component), "unknown"), lastValid: !!(component.code?.custom && component.code.pvoTouched && component.code.pvoLastValid) };
  }
  function begin(component: PvoComponent, index: number, id?: string): string {
    const interactionId = id ?? `${runId || "unobserved"}:input:${++serial}`;
    if (!id) record({ type: "interaction.received", interactionId, componentId: component.id, sceneId: component.sceneId, target: safe(() => debugTarget(component, index), "Control"), source: source(component) });
    return interactionId;
  }
  function context(component: PvoComponent, response?: ComponentResponse, id?: string): PvoDiagnosticContext {
    return { interactionId: id ?? (response ? responses.get(response) : latest.get(component.id)), sceneId: component.sceneId, source: source(component) };
  }
  function response(component: PvoComponent, value: ComponentResponse, id?: string): string {
    const interactionId = begin(component, value.index, id);
    responses.set(value, interactionId);
    return interactionId;
  }
  function observer() {
    const captured = runId;
    return (event: PvoDiagnosticEvent) => safe(() => sink?.record(captured, event, getState()), undefined);
  }
  function stateObserver() {
    const captured = runId;
    return (value: Record<string, unknown>) => safe(() => sink?.state(captured, value), undefined);
  }
  return { start, record, begin, response, context, observer, stateObserver,
    target: (component: PvoComponent, index: number) => safe(() => debugTarget(component, index), "Control"),
    accepted: (componentId: string, interactionId: string) => latest.set(componentId, interactionId),
    capture: () => safe(() => sink?.capture() ?? false, false),
    stop: (reason = "try_stopped", failed = false) => safe(() => sink?.stop(runId, reason, failed), undefined),
    event: (component: PvoComponent, type: PvoDiagnosticEvent["type"], reason?: string, id?: string, extra: Partial<PvoDiagnosticEvent> = {}) =>
      record({ ...context(component, undefined, id), type, componentId: component.id, reason, ...extra }),
  };
}
