import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "../actions/operations.js";
import { updateRequestStatus } from "../actions/request-status.js";
import { needsResponseBoundary, responseBoundaryWork } from "../actions/response-policy.js";
import { reportPlayerDiagnostic } from "../actions/diagnostics.js";

export function createPlaybackTransitions({ session, refs, adapters }) {
  function releaseUnavailableResponse(component) {
    if (session.awaitingComponent?.id !== component.id || adapters.componentCanReceiveResponse(component)) return;
    session.awaitingComponent = null;
    adapters.renderOverlays(true);
    // The existing request failure remains in status; this releases only its invisible retry hold.
    void refs.video.play().catch(() => adapters.showControls());
  }
  /** A visible component owns playback while its dispatched request is unresolved. */
  function pauseForComponentRequest(componentId) {
    if (session.finished || session.switchingClip || !componentId) return;
    if (!adapters.visibleComponents().some(component => component.id === componentId)) return;
    refs.video.pause();
    adapters.updateProgress();
  }

  function holdAtBoundary(component, message) {
    if (session.awaitingComponent?.id === component.id) return;
    session.awaitingComponent = component;
    refs.video.pause();
    reportPlayerDiagnostic(session, "playback.hold", session.capturedResponses.get(component.id)?.diagnostic, {
      componentId: component.id,
      reason: session.capturedResponses.has(component.id) ? "applying_response" : "awaiting_answer",
    });
    const clip = adapters.activeClip();
    refs.video.currentTime = Math.min(clip.end, clip.start + Number(component.presentation?.end || 0));
    adapters.renderOverlays(true);
    adapters.updateProgress();
    adapters.setStatus(message, false, true);
    adapters.showControls();
  }

  /**
   * Apply response_policy at the end of each interactive layer. A queued action
   * owns a short boundary hold so async routing cannot lose a race with video end.
   */
  function handleResponseBoundary() {
    // Once a boundary owns playback, every later media event must keep that
    // same hold until its response outcome explicitly releases or routes it.
    if (session.awaitingComponent) return true;
    const local = session.captureMode ? adapters.elapsedTime() : adapters.localClipTime();
    const ending = adapters.componentsForClip()
      .filter((component) => needsResponseBoundary(component)
        && !session.handledResponses.has(component.id))
      .sort((a, b) => Number(a.presentation?.end || 0) - Number(b.presentation?.end || 0))
      .filter((component) => local >= Number(component.presentation?.end || 0) - 0.04);

    for (const component of ending) {
      const response = session.capturedResponses.get(component.id);
      if (session.forcedHidden.has(component.id) || !response
        && !adapters.componentCanReceiveResponse(component, Number(component.presentation?.end || 0))) {
        session.handledResponses.add(component.id);
        continue;
      }
      session.handledResponses.add(component.id);
      const work = responseBoundaryWork(component, response);
      if (work === "wait") {
        holdAtBoundary(component, component.kind === "form" ? "Submit to continue" : "Choose to continue");
        return true;
      }
      if (work === "dispatch") {
        holdAtBoundary(component, "Applying response…");
        void adapters.dispatchCapturedResponse(component.id);
        return true;
      }
    }
    return false;
  }

  function advanceAtClipEnd(force = false) {
    const clip = adapters.activeClip();
    if (!clip || session.switchingClip || session.finished) return;
    if (!force && refs.video.currentTime < clip.end - 0.04) return;
    if (handleResponseBoundary()) return;
    const next = session.currentClipIndex + 1;
    if (next < session.currentTimeline.clips.length) {
      void adapters.loadClip(next, true).catch((error) => adapters.setStatus(error.message, true));
      return;
    }
    finishExperience();
  }

  function finishExperience() {
    invalidatePlaybackNavigation(session);
    refs.video.pause();
    session.finished = true;
    session.awaitingComponent = null;
    refs.endScreen.hidden = false;
    adapters.renderOverlays(true);
    adapters.updateProgress();
    updateRequestStatus(session, adapters.setStatus);
    adapters.showControls();
  }

  async function restartExperience(autoplay = true) {
    if (!session.manifest) return;
    invalidatePlaybackNavigation(session);
    invalidateActionOperations(session);
    clearResponseProgress(session);
    session.forcedVisible = new Set();
    session.forcedHidden = new Set();
    session.finished = false;
    session.renderedOverlayKey = "";
    refs.endScreen.hidden = true;
    adapters.replaceActionRuntime(false);
    session.currentTimeline = adapters.timelineById(session.manifest.playback.initial_timeline);
    adapters.setStatus("");
    await adapters.loadClip(0, autoplay);
  }

  return { finishExperience, restartExperience, handleResponseBoundary, advanceAtClipEnd, releaseUnavailableResponse, pauseForComponentRequest };
}
