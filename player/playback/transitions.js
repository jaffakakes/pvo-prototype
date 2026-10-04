import {
  clipEndTransition,
  responseBoundaryDecision,
} from "./transition-policy.js";

export function createPlaybackTransitions({ state, refs, adapters }) {
  function releaseUnavailableResponse(component) {
    if (
      state.read().awaitingComponent?.id !== component.id ||
      adapters.componentCanReceiveResponse(component)
    )
      return;
    state.releaseHold();
    adapters.renderOverlays(true);
    // The existing request failure remains in status; this releases only its invisible retry hold.
    void refs.video.play().catch(() => adapters.showControls());
  }
  /** A visible component owns playback while its dispatched request is unresolved. */
  function pauseForComponentRequest(componentId) {
    const { finished, switchingClip } = state.read();
    if (finished || switchingClip || !componentId) return;
    if (
      !adapters
        .visibleComponents()
        .some((component) => component.id === componentId)
    )
      return;
    refs.video.pause();
    adapters.updateProgress();
  }

  function holdAtBoundary(component, message) {
    if (state.read().awaitingComponent?.id === component.id) return;
    state.hold(component, () => refs.video.pause());
    const clip = adapters.activeClip();
    refs.video.currentTime = Math.min(
      clip.end,
      clip.start + Number(component.presentation?.end || 0),
    );
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
    const playback = state.read();
    if (playback.awaitingComponent) return true;
    const local = playback.captureMode
      ? adapters.elapsedTime()
      : adapters.localClipTime();
    const ending = state.boundaries(adapters.componentsForClip(), local);

    for (const boundary of ending) {
      const { component, response, hidden } = boundary;
      const canReceiveResponse =
        !hidden &&
        !response &&
        adapters.componentCanReceiveResponse(
          component,
          Number(component.presentation?.end || 0),
        );
      const work = responseBoundaryDecision({
        ...boundary,
        canReceiveResponse,
      });
      state.markHandled(component.id);
      if (work === "wait") {
        holdAtBoundary(
          component,
          component.kind === "form"
            ? "Submit to continue"
            : "Choose to continue",
        );
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
    const transition = clipEndTransition({
      ...state.read(),
      clip: adapters.activeClip(),
      mediaTime: refs.video.currentTime,
      force,
    });
    if (transition.kind === "none" || handleResponseBoundary()) return;
    if (transition.kind === "next") {
      void adapters
        .loadClip(transition.index, true)
        .catch((error) => adapters.setStatus(error.message, true));
      return;
    }
    finishExperience();
  }

  function finishExperience() {
    state.finish(() => refs.video.pause());
    refs.endScreen.hidden = false;
    adapters.renderOverlays(true);
    adapters.updateProgress();
    state.refreshRequestStatus(adapters.setStatus);
    adapters.showControls();
  }

  async function restartExperience(autoplay = true) {
    const initialTimelineId = state.resetForRestart();
    if (initialTimelineId === null) return;
    refs.endScreen.hidden = true;
    adapters.replaceActionRuntime(false);
    state.selectTimeline(adapters.timelineById(initialTimelineId));
    adapters.setStatus("");
    await adapters.loadClip(0, autoplay);
  }

  return {
    finishExperience,
    restartExperience,
    handleResponseBoundary,
    advanceAtClipEnd,
    releaseUnavailableResponse,
    pauseForComponentRequest,
  };
}
