import { createTryRecovery } from "./createTryRecovery";
import {
  freshTryMode,
  nextTryBoundary,
  resumeTryPlayback,
} from "../../domain/preview/playback";
import { createTryResponses } from "./createTryResponses";
import { createTryRequests } from "./createTryRequests";
import type { TrySessionHost, TrySessionState } from "./trySessionHost";
import { sceneDuration } from "../../domain/scenes/duration";
import { fieldsShownFor } from "../../domain/components/fields";
import {
  assertResponsePolicyContract,
  responsePolicyFor,
} from "../../domain/components/responsePolicy";
import type { PlaybackOutcome, PvoComponent } from "../../domain/project/model";
import { createTryRuntimeBridge } from "./createTryRuntimeBridge";
import { createTryDiagnostics } from "./createTryDiagnostics";

/**
 * Viewer preview follows the format note: components show for their layer,
 * explicit routes run according to each component's response policy, while
 * routing remains an ordinary optional action independent from waiting.
 */
export function createTrySession(host: TrySessionHost) {
  const diagnostics = createTryDiagnostics(host.getState, host.diagnostics);
  let trySessionEpoch = 0;
  type EditingLocation = Pick<
    TrySessionState,
    "currentSceneId" | "t" | "sel" | "selComp" | "selText" | "sheet"
  >;
  let editingLocation: EditingLocation | null = null;
  const runtimeBridge = createTryRuntimeBridge({
    getState: host.getState,
    request: host.request,
    publishRuntimeState: host.publishRuntimeState,
    applyPlaybackOutcome: runPlaybackOutcome,
    diagnosticObserver: diagnostics.observer,
    diagnosticStateObserver: diagnostics.stateObserver,
    captureDiagnosticBodies: diagnostics.capture,
  });
  const requests = createTryRequests({ ...host, diagnostics }, runtimeBridge);
  const responses = createTryResponses({
    host,
    diagnostics,
    runtimeBridge,
    requests,
    getEpoch: () => trySessionEpoch,
    stopTry,
    runPlaybackOutcome,
  });
  function getTryRuntime() {
    return runtimeBridge.current();
  }
  function startTry() {
    const s = host.getState();
    if (s.tryMode || sceneDuration(s) <= 0) return;
    diagnostics.start(s.t >= sceneDuration(s) ? 0 : s.t);
    try {
      const components = s.scenes.flatMap((scene) => scene.components);
      assertResponsePolicyContract(components);
      const unanswerable = components.find(
        (component) =>
          component.type === "card" &&
          responsePolicyFor(component).unanswered === "pause" &&
          !fieldsShownFor(component).buttons?.length,
      );
      if (unanswerable)
        throw new Error(
          "A Message cannot pause for a response without a button.",
        );
      trySessionEpoch += 1;
      requests.cancel();
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
      tryMode: freshTryMode(),
      playing: true,
      t: s.t >= sceneDuration(s) ? 0 : s.t,
      orb: false,
      ratioMenu: false,
    });
  }
  function stopTry() {
    trySessionEpoch += 1;
    requests.cancel();
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
  function enterScene(
    component: PvoComponent,
    sceneId: string,
    interactionId?: string,
  ): boolean {
    const s = host.getState();
    const target = s.scenes.find((scene) => scene.id === sceneId);
    diagnostics.event(
      component,
      "playback.scene_requested",
      undefined,
      interactionId,
    );
    if (!target || sceneDuration(target) <= 0) {
      host.emptyScene(component.id);
      diagnostics.event(
        component,
        "playback.route_failed",
        "empty_scene",
        interactionId,
      );
      return false;
    }
    requests.cancel(component.id, "scene_changed");
    host.clearFeedback();
    s.switchScene(target.id, { undoable: false, preserveTry: true });
    host.getState().patch({ tryMode: freshTryMode(), t: 0, playing: true });
    diagnostics.event(
      component,
      "playback.released",
      "scene_changed",
      interactionId,
    );
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
      diagnostics.event(
        component,
        "action.cancelled",
        "try_stopped",
        interactionId,
      );
      return false;
    }
    if (outcome.kind === "scene") {
      return enterScene(component, outcome.sceneId, interactionId);
    }
    // Another component's plain continue cannot release a response waiting at its layer end.
    if (
      outcome.kind === "continue" &&
      mode.holdingId &&
      mode.holdingId !== component.id
    ) {
      diagnostics.event(
        component,
        "action.skipped",
        "other_component_holding",
        interactionId,
      );
      return true;
    }
    if (outcome.kind === "time") {
      diagnostics.event(
        component,
        "playback.seek_requested",
        undefined,
        interactionId,
      );
      requests.cancel(component.id, "seek");
    }
    s.patch({ ...resumeTryPlayback(s, mode, outcome), playing: true });
    diagnostics.event(
      component,
      "playback.released",
      outcome.kind,
      interactionId,
    );
    return true;
  }

  /** Returns true when a response boundary or the end of the video consumed this playback frame. */
  function advanceTry(s: TrySessionState, next: number) {
    const mode = s.tryMode;
    if (!mode) return false;
    const ending = nextTryBoundary(s, mode, next);
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
          tryMode: {
            ...mode,
            playing: false,
            holdingId: ending.component.id,
            handled,
          },
        });
        void responses.dispatchCapturedResponse(ending.component);
        return true;
      }
      s.patch({
        t: ending.end,
        tryMode: { ...mode, handled },
      });
      return true;
    }
    if (next < sceneDuration(s)) return false;
    if (requests.pendingCount) {
      const end = sceneDuration(s);
      // Keep the pending request's component visible at the final frame so an
      // unhandled failure has a place to show its feedback and accept a retry.
      const holdingId = requests.firstPendingId();
      const held = s.components.find((component) => component.id === holdingId);
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
    ...createTryRecovery(
      host,
      () => trySessionEpoch,
      responses.runComponentResponse,
    ),
    beginComponentInteraction: diagnostics.begin,
    recordTryDiagnostic: diagnostics.record,
    observeTryDiagnostics: diagnostics.observer,
    getTryRuntime,
    startTry,
    stopTry,
    failTry,
    runComponentResponse: responses.runComponentResponse,
    runFormSubmission: responses.runFormSubmission,
    advanceTry,
  };
}
