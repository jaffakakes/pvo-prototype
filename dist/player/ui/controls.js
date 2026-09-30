import { createPublicationSharing } from "../publication/sharing.js";

export function createPlayerControls({ session, refs, adapters, publication = null }) {
  const sharing = createPublicationSharing({
    publication, buttons: [refs.share, refs.endShare], title: document.title, setStatus,
  });
  function updateTimelineLabel(timeline) {
    const sceneId = timeline.clips?.[0]?.scene;
    const scene = session.manifest?.scenes?.find(item => item.id === sceneId);
    if (session.captureMode && scene) {
      refs.timeline.textContent = scene.label || scene.id;
      return;
    }
    refs.timeline.textContent = timeline.kind === "branch" ? "Branch timeline" : "Main timeline";
  }

  function setStatus(message, error = false, visible = error) {
    refs.status.textContent = message;
    refs.status.classList.toggle("error", error);
    refs.status.classList.toggle("is-visible", Boolean(message) && visible);
  }

  function formatTime(seconds) {
    const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(value / 60);
    const remaining = Math.floor(value % 60);
    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  function updateProgress() {
    const elapsed = adapters.elapsedTime();
    const total = adapters.timelineDuration();
    refs.progress.max = Math.max(total, 1);
    refs.progress.value = Math.min(elapsed, total);
    refs.progress.style.setProperty("--progress", `${total ? elapsed / total * 100 : 0}%`);
    refs.time.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
    const paused = refs.video.paused;
    refs.play.textContent = paused ? "▶" : "❚❚";
    refs.play.setAttribute("aria-label", paused ? "Play" : "Pause");
    refs.mute.textContent = refs.video.muted ? "🔇" : "🔊";
    refs.mute.setAttribute("aria-label", refs.video.muted ? "Unmute" : "Mute");
    if (refs.volume) refs.volume.value = refs.video.muted ? 0 : refs.video.volume;
    refs.centerPlay.hidden = !paused || Boolean(session.awaitingComponent) || session.finished || session.switchingClip;
  }

  function hideControls() {
    if (session.switchingClip || refs.video.paused || session.finished || session.awaitingComponent) return;
    refs.frame.classList.remove("controls-visible");
  }

  function showControls(sticky = false) {
    refs.frame.classList.add("controls-visible");
    window.clearTimeout(session.controlsTimer);
    session.controlsTimer = null;
    if (!sticky) session.controlsTimer = window.setTimeout(hideControls, 2600);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (refs.frame.requestFullscreen) {
        await refs.frame.requestFullscreen();
      } else if (refs.video.webkitEnterFullscreen) {
        refs.video.webkitEnterFullscreen();
      }
    } catch {
      setStatus("Full screen is unavailable in this browser.", true);
    }
  }

  function togglePlayback() {
    if (session.finished) { void adapters.restartExperience(true); return; }
    if (session.awaitingComponent) { showControls(); return; }
    if (refs.video.paused) void refs.video.play().catch(() => setStatus("Playback could not start.", true));
    else refs.video.pause();
  }

  return {
    setStatus, updateTimelineLabel, updateProgress, showControls, togglePlayback, toggleFullscreen,
    shareExperience: sharing.share,
    destroy() { sharing.destroy(); window.clearTimeout(session.controlsTimer); },
  };
}
