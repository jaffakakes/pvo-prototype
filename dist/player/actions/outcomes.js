import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "./operations.js";

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
    if (outcome?.kind === "scene") {
      invalidatePlaybackNavigation(session);
      const target = adapters.captureTimelineForScene(outcome.sceneId);
      if (!target) throw new Error("That scene is not available in this PVO.");
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
      invalidatePlaybackNavigation(session);
      session.awaitingComponent = null;
      reopenFinishedExperience();
      await adapters.seekToElapsed(outcome.t, true, { responseBoundaries: "skip" });
      return;
    }
    if (session.awaitingComponent && session.awaitingComponent.id !== component.id) return;
    session.awaitingComponent = null;
    if (session.finished) {
      adapters.renderOverlays(true);
      return;
    }
    if (session.deferredContinueSeekId !== null) {
      adapters.renderOverlays(true);
      return;
    }
    await refs.video.play().catch(() => adapters.showControls());
    adapters.renderOverlays(true);
  }

  return { captureOutcome, applyActionOutcome };
}
