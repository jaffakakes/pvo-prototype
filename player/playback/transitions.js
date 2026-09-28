export function createPlaybackTransitions({ session, refs, adapters }) {
  async function startSelectedBranch(component) {
    const answer = session.answers.get(component.id);
    if (answer === undefined || session.handledBranches.has(component.id)) return;
    const route = adapters.routeForAnswer(component, answer);
    const target = adapters.timelineById(route?.timelineId) || adapters.captureTimelineForScene(route?.sceneId);
    if (!target) {
      finishExperience();
      adapters.setStatus("The selected branch is missing from this PVO.", true);
      return;
    }
    session.handledBranches.add(component.id);
    session.awaitingComponent = null;
    session.currentTimeline = target;
    adapters.setStatus("");
    await adapters.loadClip(0, true);
  }

  /**
   * A choice or form with scene_change keeps playing after an early answer and
   * branches when its layer ends. Unanswered, playback waits there with the
   * component visible. A component behind the video cannot wait for a tap.
   */
  function branchAtCurrentTime() {
    const local = session.captureMode ? adapters.elapsedTime() : adapters.localClipTime();
    const component = adapters.componentsForClip()
      .filter((item) => item.scene_change?.enabled && !session.handledBranches.has(item.id) && adapters.captureAboveVideo(item))
      .sort((a, b) => Number(a.presentation?.end || 0) - Number(b.presentation?.end || 0))
      .find((item) => local >= Number(item.presentation?.end || 0) - 0.04);
    if (!component) return false;
    if (!session.answers.has(component.id)) {
      if (session.awaitingComponent?.id === component.id) return true;
      session.awaitingComponent = component;
      refs.video.pause();
      const clip = adapters.activeClip();
      refs.video.currentTime = Math.min(clip.end, clip.start + Number(component.presentation?.end || 0));
      adapters.renderOverlays(true);
      adapters.updateProgress();
      adapters.setStatus(component.kind === "form" ? "Submit to continue" : "Choose to continue", false, true);
      adapters.showControls();
      return true;
    }
    void startSelectedBranch(component);
    return true;
  }

  function advanceAtClipEnd(force = false) {
    const clip = adapters.activeClip();
    if (!clip || session.switchingClip || session.finished) return;
    if (!force && refs.video.currentTime < clip.end - 0.04) return;
    if (branchAtCurrentTime()) return;
    const next = session.currentClipIndex + 1;
    if (next < session.currentTimeline.clips.length) {
      void adapters.loadClip(next, true).catch((error) => adapters.setStatus(error.message, true));
      return;
    }
    // A selected branch is the ending; nothing returns to the timeline that routed there.
    finishExperience();
  }

  function finishExperience() {
    refs.video.pause();
    session.finished = true;
    session.awaitingComponent = null;
    refs.endScreen.hidden = false;
    adapters.renderOverlays(true);
    adapters.updateProgress();
    adapters.setStatus("");
    adapters.showControls();
  }

  async function restartExperience(autoplay = true) {
    if (!session.manifest) return;
    session.answers = new Map();
    session.actionRuntime?.reset();
    session.forcedVisible = new Set();
    session.forcedHidden = new Set();
    session.pendingComponents = new Set();
    session.handledBranches = new Set();
    session.awaitingComponent = null;
    session.finished = false;
    session.renderedOverlayKey = "";
    refs.endScreen.hidden = true;
    session.currentTimeline = adapters.timelineById(session.manifest.playback.initial_timeline);
    adapters.setStatus("");
    await adapters.loadClip(0, autoplay);
  }

  return { finishExperience, restartExperience, startSelectedBranch, branchAtCurrentTime, advanceAtClipEnd };
}
