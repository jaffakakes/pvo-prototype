import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "./operations.js";
import { reportPlayerDiagnostic } from "./diagnostics.js";

export function createOutcomeRouter({ session, refs, adapters }) {
  function reopenFinishedExperience() {
    session.finished = false;
    refs.endScreen.hidden = true;
  }

  /** The editor-authored outcome for a control, used when its executed actions did not route. */
  function captureOutcome(component, index) {
    const specified = component.restyle_capture?.outcomes?.[index];
    if (specified) return specified;
    const card = component.actions?.[index];
    const action = component.kind === "choice" ? component.options?.[index]?.action
      : component.kind === "card" ? card?.action : component.on_submit;
    if (action?.type === "goto_scene") return { kind: "scene", sceneId: action.scene };
    if (action?.type === "seek") return { kind: "time", t: action.time };
    return { kind: "continue" };
  }

  /** Apply the explicit authored playback result after its response is dispatched. */
  async function applyActionOutcome(component, _index, outcome) {
    const diagnostic = session.capturedResponses.get(component.id)?.diagnostic;
    if (outcome?.kind === "scene") {
      reportPlayerDiagnostic(session, "playback.scene_requested", diagnostic, { target: outcome.sceneId });
      invalidatePlaybackNavigation(session);
      const target = adapters.captureTimelineForScene(outcome.sceneId);
      if (!target) {
        reportPlayerDiagnostic(session, "playback.route_failed", diagnostic, { reason: "missing_scene" });
        throw new Error("That scene is not available in this PVO.");
      }
      reopenFinishedExperience();
      if (invalidateActionOperations(session)) {
        adapters.replaceActionRuntime(true);
        adapters.setStatus("");
      }
      clearResponseProgress(session);
      session.currentTimeline = target;
      adapters.renderOverlays(true);
      await adapters.loadClip(0, true);
      return;
    }
    if (outcome?.kind === "time") {
      reportPlayerDiagnostic(session, "playback.seek_requested", diagnostic, { waitUntil: outcome.t });
      invalidatePlaybackNavigation(session);
      session.awaitingComponent = null;
      reopenFinishedExperience();
      await adapters.seekToElapsed(outcome.t, true, { responseBoundaries: "skip" });
      return;
    }
    if (session.awaitingComponent && session.awaitingComponent.id !== component.id) {
      reportPlayerDiagnostic(session, "playback.hold", diagnostic, {
        componentId: session.awaitingComponent.id, reason: "another_component",
      });
      return;
    }
    session.awaitingComponent = null;
    reportPlayerDiagnostic(session, "playback.released", diagnostic);
    if (session.finished) {
      adapters.renderOverlays(true);
      return;
    }
    if (session.deferredContinueSeekId !== null) {
      adapters.renderOverlays(true);
      return;
    }
    reportPlayerDiagnostic(session, "media.play_requested", diagnostic);
    await refs.video.play().catch(() => {
      reportPlayerDiagnostic(session, "media.play_rejected", diagnostic);
      adapters.showControls();
    });
    adapters.renderOverlays(true);
  }

  return { captureOutcome, applyActionOutcome };
}
