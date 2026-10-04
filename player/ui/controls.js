import { createPublicationSharing } from "../publication/sharing.js";
import { playerViewState, formatDuration } from "./view-state.js";
import { playerIcon } from "./icons.js";

/** Present playback state and route every entry point to the same commands. */
export function createPlayerControls({ session, refs, adapters, publication = null }) {
  const sharing = createPublicationSharing({
    publication, buttons: refs.shares, title: document.title, setStatus,
  });
  let lastSound;
  let lastBadge;

  function updateTimelineLabel(timeline) {
    const sceneId = timeline.clips?.[0]?.scene;
    const scene = session.manifest?.scenes?.find(item => item.id === sceneId);
    refs.timeline.textContent = session.captureMode && scene
      ? scene.label || scene.id : timeline.kind === "branch" ? "Branch timeline" : "Main timeline";
  }

  function currentView() {
    return playerViewState(session, refs.video, adapters.visibleComponents?.() || []);
  }

  function setStatus(message, error = false, visible = error) {
    const opening = !refs.empty.hidden;
    if (refs.openStatus) {
      const showOpenStatus = opening && Boolean(message) && visible;
      refs.openStatus.hidden = !showOpenStatus;
      const openMessage = error ? "Couldn't open this PVO." : message;
      refs.openStatus.textContent = showOpenStatus ? openMessage : "";
      refs.openDetails.hidden = !showOpenStatus || !error;
      refs.openDetails.open = false;
      refs.openError.textContent = showOpenStatus && error ? message : "";
    }
    const { state } = currentView();
    // Request and hold feedback has one surface: the status sticker.
    const ownedByWidget = ["submitting", "error"].includes(state) || (state === "waiting" && !error);
    const showPlayerStatus = !opening && !ownedByWidget;
    refs.status.textContent = showPlayerStatus ? message : "";
    refs.status.classList.toggle("error", error && showPlayerStatus);
    refs.status.classList.toggle("is-visible", Boolean(message) && visible && showPlayerStatus);
    updateProgress();
  }

  function updateMetadata() {
    const title = publication ? document.title : session.manifest?.title || "Untitled video";
    const main = session.manifest?.playback?.timelines?.find(timeline =>
      timeline.id === session.manifest.playback.initial_timeline);
    const duration = main ? main.clips.reduce((total, clip) => total + Math.max(0, clip.end - clip.start), 0)
      : adapters.timelineDuration();
    refs.titles.forEach(element => {
      if (element.textContent !== title) element.textContent = title;
      element.title = title;
    });
    // The publication contract carries no public creator name. Never invent an attribution.
    const meta = formatDuration(duration);
    refs.metadata.forEach(element => { if (element.textContent !== meta) element.textContent = meta; });
  }

  function updateProgress() {
    const { state, component } = currentView();
    const held = ["waiting", "submitting", "error"].includes(state);
    if (refs.frame.dataset.state !== state) refs.frame.dataset.state = state;
    refs.mute.hidden = held;
    refs.holdStatus.hidden = !held;
    refs.retry.hidden = state !== "error";
    refs.holdArrow.hidden = state !== "waiting";
    if (lastSound !== refs.video.muted) {
      lastSound = refs.video.muted;
      const label = lastSound ? "Unmute" : "Mute";
      refs.soundLabel.textContent = label;
      refs.soundIcon.innerHTML = playerIcon(lastSound ? "muted" : "sound");
      refs.mute.setAttribute("aria-label", label);
      refs.mute.setAttribute("aria-pressed", String(!lastSound));
    }
    const label = state === "submitting" ? "Sending…" : state === "error" ? "Couldn't send"
      : component?.kind === "form" ? "Submit to continue" : "Choose to continue";
    if (refs.holdLabel.textContent !== label) refs.holdLabel.textContent = label;
    if (lastBadge !== state) {
      lastBadge = state;
      refs.holdBadge.dataset.mode = state;
      refs.holdBadge.innerHTML = state === "submitting" ? '<span class="status-spinner"></span>'
        : playerIcon(state === "error" ? "error" : "hold");
    }
    refs.centerPlay.hidden = state !== "paused" || session.switchingClip;
    refs.endScreen.hidden = state !== "finished";
    if (state === "submitting" || state === "error") {
      refs.status.classList.remove("is-visible", "error");
      refs.status.textContent = "";
    }
    updateMetadata();
    adapters.updateLayout?.();
  }

  function pulseComponent(component) {
    if (!component || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = [...refs.overlay.querySelectorAll(".component-position")]
      .find(element => element.dataset.componentId === component.id
        || element.dataset.layerId === `component:${component.id}`);
    target?.animate([{ scale: "1" }, { scale: "1.04" }, { scale: "1" }], { duration: 150 });
  }

  function togglePlayback() {
    const { state, component } = currentView();
    if (["waiting", "submitting", "error"].includes(state)) { pulseComponent(component); return; }
    if (session.finished) { void adapters.restartExperience(true); return; }
    if (session.switchingClip) return;
    if (refs.video.paused) void refs.video.play().catch(() => setStatus("Playback could not start.", true));
    else refs.video.pause();
  }

  function toggleMute() {
    refs.video.muted = !refs.video.muted;
    updateProgress();
  }

  function retryResponse() {
    const { state, component } = currentView();
    if (state === "error" && component) void adapters.dispatchCapturedResponse(component.id);
  }

  return {
    setStatus, updateTimelineLabel, updateProgress, togglePlayback, toggleMute, retryResponse,
    showControls: updateProgress,
    shareExperience: sharing.share,
    destroy() { sharing.destroy(); },
  };
}
