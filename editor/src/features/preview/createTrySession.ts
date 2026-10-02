import { sceneDuration } from "../../domain/scenes/duration";
import { describeRequestFailure, type PvoRequestFailure } from "../../../../packages/pvo-sdk/index.js";
import { actionFor } from "../../domain/components/actions";
import { fieldsShownFor } from "../../domain/components/fields";
import {
  acceptsResponse,
  assertResponsePolicyContract,
  responsePolicyFor,
} from "../../domain/components/responsePolicy";
import {
  formSubmissionOutcome,
  formValuesForSubmission,
  validateFormFields,
} from "../../domain/components/forms";
import { componentEnd } from "../../domain/components/timing";
import { componentInteractionAvailable } from "../../domain/animation/interaction";
import { projectRatio } from "../../domain/project/ratio";
import type {
  ComponentResponse,
  PlaybackOutcome,
  PvoComponent,
} from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import type { CaptureState, TryMode } from "../../state/types";
import { createTryRuntimeBridge } from "./createTryRuntimeBridge";
import { createTryDiagnostics, type TryDiagnosticSink } from "./createTryDiagnostics";

type TrySessionState = Pick<
  CaptureState,
  | "currentSceneId"
  | "localId"
  | "t"
  | "sel"
  | "selComp"
  | "selText"
  | "sheet"
  | "scenes"
  | "clips"
  | "components"
  | "texts"
  | "layers"
  | "ratio"
  | "allowedDomains"
  | "tryMode"
  | "patch"
  | "switchScene"
>;
type Host = {
  diagnostics?: TryDiagnosticSink;
  getState(): TrySessionState;
  request: typeof fetch;
  publishRuntimeState(state: Record<string, unknown> | null): void;
  feedback(): Record<string, { phase: string }>;
  clearFeedback(): void;
  clearNotice(): void;
  startFailed(): void;
  playbackFailed(): void;
  emptyScene(id: string): void;
  beginRequest(id: string): number;
  finishRequest(id: string, operation: number, failed: boolean, failure?: PvoRequestFailure): void;
};

const freshMode = (): TryMode => ({
  playing: true,
  holdingId: null,
  handled: [],
  capturedResponses: {},
  dispatched: [],
});

/**
 * Viewer preview follows the format note: components show for their layer,
 * explicit routes run according to each component's response policy, while
 * routing remains an ordinary optional action independent from waiting.
 */
export function createTrySession(host: Host) {
  const diagnostics = createTryDiagnostics(host.getState, host.diagnostics);
  let trySessionEpoch = 0;
  const requestOperations = new Map<string, {
    controller: AbortController;
    feedbackOperation: number;
  }>();
  type EditingLocation = Pick<
    TrySessionState,
    "currentSceneId" | "t" | "sel" | "selComp" | "selText" | "sheet"
  >;
  let editingLocation: EditingLocation | null = null;
  function interactionAvailable(state: TrySessionState, component: PvoComponent, time: number) {
    const ratio = projectRatio(state.ratio);
    return componentInteractionAvailable(state, component, time, ratio[0] / ratio[1]);
  }
  const runtimeBridge = createTryRuntimeBridge({
    getState: host.getState,
    request: host.request,
    publishRuntimeState: host.publishRuntimeState,
    applyPlaybackOutcome: runPlaybackOutcome,
    diagnosticObserver: diagnostics.observer,
    diagnosticStateObserver: diagnostics.stateObserver,
    captureDiagnosticBodies: diagnostics.capture,
  });
  function getTryRuntime() {
    return runtimeBridge.current();
  }
  function cancelRequestOperations(exceptComponentId?: string, reason = "try_stopped") {
    requestOperations.forEach((operation, componentId) => {
      if (componentId !== exceptComponentId) {
        const component = host.getState().components.find(item => item.id === componentId);
        if (component) diagnostics.event(component, "action.cancelled", reason);
        operation.controller.abort();
        host.finishRequest(componentId, operation.feedbackOperation, false);
      }
    });
    for (const componentId of [...requestOperations.keys()]) {
      if (componentId !== exceptComponentId) requestOperations.delete(componentId);
    }
  }
  function startTry() {
    const s = host.getState();
    if (s.tryMode || sceneDuration(s) <= 0) return;
    diagnostics.start(s.t >= sceneDuration(s) ? 0 : s.t);
    try {
      const components = s.scenes.flatMap((scene) => scene.components);
      assertResponsePolicyContract(components);
      const unanswerable = components.find((component) => component.type === "card"
        && responsePolicyFor(component).unanswered === "pause"
        && !(fieldsShownFor(component).buttons?.length));
      if (unanswerable) throw new Error("A Message cannot pause for a response without a button.");
      trySessionEpoch += 1;
      cancelRequestOperations();
      host.clearFeedback();
      host.clearNotice();
      runtimeBridge.start(s);
    } catch (error) {
      diagnostics.stop("start_error", true);
      console.error("Could not start viewer preview:", error);
      host.startFailed();
      return;
    }
    editingLocation = {
      currentSceneId: s.currentSceneId,
      t: s.t,
      sel: s.sel,
      selComp: s.selComp,
      selText: s.selText,
      sheet: s.sheet,
    };
    // The workspace hides the mounted editing region so its tab and height survive Try.
    s.patch({
      tryMode: freshMode(),
      playing: true,
      t: s.t >= sceneDuration(s) ? 0 : s.t,
      orb: false,
      ratioMenu: false,
    });
  }
  function stopTry() {
    trySessionEpoch += 1;
    cancelRequestOperations();
    diagnostics.stop();
    runtimeBridge.stop();
    host.clearFeedback();
    host.clearNotice();
    const state = host.getState();
    const location = editingLocation;
    editingLocation = null;
    state.patch({
      ...(location &&
      state.scenes.some((scene) => scene.id === location.currentSceneId)
        ? location
        : {}),
      tryMode: null,
      playing: false,
    });
  }
  function failTry(error: unknown) {
    diagnostics.record({ type: "session.failed", reason: "playback_error" });
    console.error("Viewer preview stopped after a playback failure:", error);
    if (host.getState().tryMode) stopTry();
    host.playbackFailed();
  }
  /** A chosen scene is the rest of the video: nothing returns to the scene that routed there. */
  function enterScene(component: PvoComponent, sceneId: string, interactionId?: string): boolean {
    const s = host.getState();
    const target = s.scenes.find((scene) => scene.id === sceneId);
    diagnostics.event(component, "playback.scene_requested", undefined, interactionId);
    if (!target || sceneDuration(target) <= 0) {
      host.emptyScene(component.id);
      diagnostics.event(component, "playback.route_failed", "empty_scene", interactionId);
      return false;
    }
    cancelRequestOperations(component.id, "scene_changed");
    host.clearFeedback();
    s.switchScene(target.id, { undoable: false, preserveTry: true });
    host.getState().patch({ tryMode: freshMode(), t: 0, playing: true });
    diagnostics.event(component, "playback.released", "scene_changed", interactionId);
    return true;
  }
  function runPlaybackOutcome(
    component: PvoComponent,
    outcome: PlaybackOutcome,
    interactionId?: string,
  ): boolean {
    const s = host.getState();
    const mode = s.tryMode;
    if (!mode) {
      diagnostics.event(component, "action.cancelled", "try_stopped", interactionId);
      return false;
    }
    if (outcome.kind === "scene") {
      return enterScene(component, outcome.sceneId, interactionId);
    }
    // Another component's plain continue cannot release a response waiting at its layer end.
    if (outcome.kind === "continue" && mode.holdingId && mode.holdingId !== component.id) {
      diagnostics.event(component, "action.skipped", "other_component_holding", interactionId);
      return true;
    }
    const t = outcome.kind === "time" ? clamp(outcome.t, 0, sceneDuration(s)) : s.t;
    if (outcome.kind === "time") {
      diagnostics.event(component, "playback.seek_requested", undefined, interactionId);
      cancelRequestOperations(component.id, "seek");
    }
    // Seeking behind a processed boundary lets that component accept a new response.
    const handled =
      t < s.t
        ? mode.handled.filter((id) => {
            const item = s.components.find((candidate) => candidate.id === id);
            return !!item && componentEnd(item, s.clips) < t;
          })
        : mode.handled;
    const keepResponse = (id: string) => {
      const item = s.components.find((candidate) => candidate.id === id);
      return !!item && componentEnd(item, s.clips) < t;
    };
    const capturedResponses = t < s.t
      ? Object.fromEntries(Object.entries(mode.capturedResponses).filter(([id]) => keepResponse(id)))
      : mode.capturedResponses;
    const dispatched = t < s.t ? mode.dispatched.filter(keepResponse) : mode.dispatched;
    s.patch({
      t,
      tryMode: { ...mode, playing: true, holdingId: null, handled, capturedResponses, dispatched },
      playing: true,
    });
    diagnostics.event(component, "playback.released", outcome.kind, interactionId);
    return true;
  }

  function writeResponseState(component: PvoComponent, response: ComponentResponse) {
    const runtime = runtimeBridge.current();
    if (!runtime) return;
    if (component.type === "form" && response.formValues) {
      runtime.setState("form", {
        ...(runtime.state.form as Record<string, unknown> | undefined),
        [component.id]: response.formValues,
      }, { componentId: component.id, diagnostic: diagnostics.context(component, response) });
    }
    if (component.type === "choice") {
      runtime.setState("choices", {
        ...(runtime.state.choices as Record<string, unknown> | undefined),
        [component.id]: response.index,
      }, { componentId: component.id, diagnostic: diagnostics.context(component, response) });
    }
  }

  /** Execute a captured response with the same SDK request policy as an exported PVO. */
  async function executeResponse(
    component: PvoComponent,
    response: ComponentResponse,
  ): Promise<boolean> {
    const state = host.getState();
    const outcome = response.outcome;
    const diagnosticContext = diagnostics.context(component, response);
    if (!state.tryMode) return false;
    if (
      outcome.kind === "request" &&
      host.feedback()[component.id]?.phase === "pending"
    ) {
      diagnostics.event(component, "interaction.ignored", "request_pending", diagnosticContext.interactionId);
      return false;
    }
    writeResponseState(component, response);
    if (
      component.type === "form" &&
      component.fields.formFields &&
      formSubmissionOutcome(component) === null
    ) {
      if (component.fields.failureOutcome)
        return runPlaybackOutcome(component, component.fields.failureOutcome, diagnosticContext.interactionId);
      const operation = host.beginRequest(component.id);
      host.finishRequest(component.id, operation, true);
      diagnostics.event(component, "action.failed", "missing_destination", diagnosticContext.interactionId);
      return false;
    }
    if (outcome.kind !== "request") {
      return runPlaybackOutcome(component, outcome, diagnosticContext.interactionId);
    }
    const runtime = runtimeBridge.current();
    if (!runtime) return false;
    const operation = host.beginRequest(component.id);
    const requestOperation = {
      controller: new AbortController(),
      feedbackOperation: operation,
    };
    requestOperations.set(component.id, requestOperation);
    const previewInteraction = { routeFailed: false };
    let actionReady = false;
    let requestErrorSeen = false;
    const unsubscribe = runtime.subscribe(event => {
      if (event.type === "request_error" && event.componentId === component.id)
        requestErrorSeen = true;
    });
    try {
      const action = actionFor(outcome, component.id);
      actionReady = true;
      await runtime.execute(action, {
        componentId: component.id,
        throwOnRequestError: true,
        signal: requestOperation.controller.signal,
        previewInteraction,
        diagnostic: diagnosticContext,
      });
      if (requestOperations.get(component.id) !== requestOperation) return false;
      host.finishRequest(component.id, operation, false);
      return !previewInteraction.routeFailed;
    } catch (error) {
      if (requestOperation.controller.signal.aborted || requestOperations.get(component.id) !== requestOperation)
        return false;
      // No error route is deliberately a no-op: the component stays available to retry.
      console.warn("PVO request failed in Try mode:", error);
      if (!requestErrorSeen) diagnostics.event(component, "action.failed", "invalid_action", diagnosticContext.interactionId);
      const latest = host.getState();
      if (
        runtimeBridge.isCurrent(runtime) &&
        latest.tryMode &&
        latest.currentSceneId === state.currentSceneId
      ) {
        // Authored error routes already communicated the result. An empty-scene
        // route has its own operation key, so completion cannot erase its status.
        host.finishRequest(
          component.id,
          operation,
          !(actionReady && outcome.onError),
          requestErrorSeen ? describeRequestFailure(error) : undefined,
        );
      }
      return !!(actionReady && outcome.onError && !previewInteraction.routeFailed);
    } finally {
      unsubscribe();
      if (requestOperations.get(component.id) === requestOperation)
        requestOperations.delete(component.id);
    }
  }

  async function dispatchCapturedResponse(component: PvoComponent): Promise<void> {
    const state = host.getState();
    const mode = state.tryMode;
    const response = mode?.capturedResponses[component.id];
    if (!mode || !response || mode.dispatched.includes(component.id)) return;
    diagnostics.event(component, "action.selected", undefined, diagnostics.context(component, response).interactionId);
    const epoch = trySessionEpoch;
    const runtime = runtimeBridge.current();
    state.patch({
      tryMode: { ...mode, dispatched: [...mode.dispatched, component.id] },
    });
    const succeeded = await executeResponse(component, response);
    const latest = host.getState();
    const latestMode = latest.tryMode;
    const terminalSettled = epoch === trySessionEpoch && runtimeBridge.isCurrent(runtime) && latestMode
      && latest.currentSceneId === component.sceneId
      && latestMode.holdingId === null
      && latest.t >= sceneDuration(latest) - .001
      && requestOperations.size === 0;
    if (terminalSettled) {
      stopTry();
      return;
    }
    if (succeeded || epoch !== trySessionEpoch || !runtimeBridge.isCurrent(runtime) || !latestMode
        || latest.currentSceneId !== component.sceneId
        || latestMode.capturedResponses[component.id] !== response) return;
    if (latestMode.holdingId === component.id && !interactionAvailable(latest, component, latest.t)) {
      // Keep the failed-request feedback, but never require a retry on an invisible control.
      latest.patch({ playing: true, tryMode: { ...latestMode, playing: true, holdingId: null } });
      return;
    }
    latest.patch({
      tryMode: {
        ...latestMode,
        dispatched: latestMode.dispatched.filter((id) => id !== component.id),
      },
    });
  }

  /** Capture locally first; the policy decides when the response reaches Logic. */
  async function runComponentResponse(
    component: PvoComponent,
    response: ComponentResponse,
    interactionId?: string,
  ): Promise<void> {
    const state = host.getState();
    const mode = state.tryMode;
    const input = diagnostics.response(component, response, interactionId);
    if (!mode || !acceptsResponse(component) || !interactionAvailable(state, component, state.t)) {
      diagnostics.event(component, "interaction.ignored", "inactive_component", input);
      return;
    }
    const policy = responsePolicyFor(component);
    const atBoundary = mode.holdingId === component.id;
    if (mode.dispatched.includes(component.id)) {
      diagnostics.event(component, "interaction.ignored", host.feedback()[component.id]?.phase === "pending" ? "request_pending" : "already_dispatched", input);
      return;
    }
    if (!atBoundary && mode.handled.includes(component.id)) {
      diagnostics.event(component, "interaction.ignored", "already_handled", input);
      return;
    }
    diagnostics.accepted(component.id, input);
    const previous = mode.capturedResponses[component.id];
    if (previous && policy.dispatch === "layer_end" && !atBoundary && !mode.handled.includes(component.id))
      diagnostics.event(component, "action.cancelled", "superseded", diagnostics.context(component, previous).interactionId);
    diagnostics.event(component, "interaction.accepted", undefined, input, { target: diagnostics.target(component, response.index) });
    const capturedResponses = { ...mode.capturedResponses, [component.id]: response };
    const handled = atBoundary && !mode.handled.includes(component.id)
      ? [...mode.handled, component.id]
      : mode.handled;
    state.patch({ tryMode: { ...mode, capturedResponses, handled } });
    if (policy.dispatch === "interaction" || atBoundary)
      await dispatchCapturedResponse(component);
    else diagnostics.event(component, "response.deferred", "layer_end", input, { waitUntil: componentEnd(component, state.clips) });
  }

  /** Form values stay in session state; only an explicit request sends them to a destination. */
  async function runFormSubmission(
    component: PvoComponent,
    values: Record<string, string>,
  ): Promise<void> {
    if (
      !host.getState().tryMode ||
      host.feedback()[component.id]?.phase === "pending"
    ) {
      const input = diagnostics.begin(component, 0);
      diagnostics.event(component, "interaction.ignored", host.getState().tryMode ? "request_pending" : "inactive_component", input);
      return;
    }
    try {
      if (component.fields.formFields)
        validateFormFields(component.fields.formFields);
      const outcome = formSubmissionOutcome(component)
        ?? component.fields.failureOutcome
        ?? { kind: "continue" };
      const formValues = formValuesForSubmission(component.fields, values);
      await runComponentResponse(component, { index: 0, outcome, formValues });
    } catch (error) {
      console.warn("Could not submit form in Try mode:", error);
      const operation = host.beginRequest(component.id);
      host.finishRequest(component.id, operation, true);
      diagnostics.event(component, "action.failed", "invalid_form");
    }
  }
  /** Returns true when a response boundary or the end of the video consumed this playback frame. */
  function advanceTry(s: TrySessionState, next: number) {
    const mode = s.tryMode;
    if (!mode) return false;
    // Visibility is evaluated at the actual boundary, including motion between playback frames.
    const ending = s.components
      .filter(
        (component) => {
          if (!acceptsResponse(component)) return false;
          const policy = responsePolicyFor(component);
          return (policy.dispatch === "layer_end" || policy.unanswered === "pause") &&
          (mode.capturedResponses[component.id] || interactionAvailable(s, component, componentEnd(component, s.clips))) &&
          !mode.handled.includes(component.id);
        },
      )
      .map((component) => ({ component, end: componentEnd(component, s.clips) }))
      .filter(({ end }) => end >= s.t - 0.001 && end <= next + 0.001)
      .sort((a, b) => a.end - b.end)[0];
    if (ending) {
      const response = mode.capturedResponses[ending.component.id];
      const policy = responsePolicyFor(ending.component);
      if (!response && policy.unanswered === "pause") {
        diagnostics.event(ending.component, "playback.hold", "awaiting_answer");
        s.patch({
          t: ending.end,
          playing: false,
          tryMode: { ...mode, playing: false, holdingId: ending.component.id },
        });
        return true;
      }
      const handled = [...mode.handled, ending.component.id];
      if (response && policy.dispatch === "layer_end") {
        diagnostics.event(ending.component, "playback.hold", "layer_end");
        // A captured response is answered, but its outcome must be resolved at
        // this exact boundary before playback can safely continue or route.
        s.patch({
          t: ending.end,
          playing: false,
          tryMode: { ...mode, playing: false, holdingId: ending.component.id, handled },
        });
        void dispatchCapturedResponse(ending.component);
        return true;
      }
      s.patch({
        t: ending.end,
        tryMode: { ...mode, handled },
      });
      return true;
    }
    if (next < sceneDuration(s)) return false;
    if (requestOperations.size) {
      const end = sceneDuration(s);
      // Keep the pending request's component visible at the final frame so an
      // unhandled failure has a place to show its feedback and accept a retry.
      const holdingId = requestOperations.keys().next().value ?? null;
      const held = s.components.find(component => component.id === holdingId);
      if (held) diagnostics.event(held, "playback.hold", "awaiting_request");
      s.patch({
        t: end,
        playing: false,
        tryMode: { ...mode, playing: false, holdingId },
      });
      return true;
    }
    // The active scene owns the remaining viewing path and ends with its timeline.
    stopTry();
    return true;
  }

  return {
    beginComponentInteraction: diagnostics.begin,
    recordTryDiagnostic: diagnostics.record,
    observeTryDiagnostics: diagnostics.observer,
    getTryRuntime,
    startTry,
    stopTry,
    failTry,
    runComponentResponse,
    runFormSubmission,
    advanceTry,
  };
}
