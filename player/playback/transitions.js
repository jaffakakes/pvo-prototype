import {
  clearResponseProgress,
  invalidateActionOperations,
  invalidatePlaybackNavigation,
} from "../actions/operations.js";
import { updateRequestStatus } from "../actions/request-status.js";
import { needsResponseBoundary, responseBoundaryWork } from "../actions/response-policy.js";

export function createPlaybackTransitions({ session, refs, adapters }) {
  function holdAtBoundary(component, message) {
    if (session.awaitingComponent?.id === component.id) return;
    session.awaitingComponent = component;
    refs.video.pause();
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
      if (session.forcedHidden.has(component.id) || !adapters.captureAboveVideo(component)) {
        session.handledResponses.add(component.id);
        continue;
      }
      const response = session.capturedResponses.get(component.id);
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

  return { finishExperience, restartExperience, handleResponseBoundary, advanceAtClipEnd };
}
