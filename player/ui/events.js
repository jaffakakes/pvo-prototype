import { bindAnimationClock } from "../playback/animation-clock.js";
import { bindPlaybackInputs } from "./input.js";
import { updateRequestStatus } from "../actions/request-status.js";
import { reportPlayerDiagnostic } from "../actions/diagnostics.js";

/** Translate shell and media events into the application's named commands. */
export function bindPlayerEvents({ session, refs, adapters }) {
  const stopAnimationClock = bindAnimationClock(refs.video, () => {
    if (session.manifest && !session.switchingClip) adapters.renderOverlays();
  });
  const listeners = new AbortController();
  const on = (element, event, handler) => element?.addEventListener(event, handler, { signal: listeners.signal });
  if (typeof session.onDiagnostic === "function") {
    for (const [eventName, type] of [
      ["playing", "media.playing"], ["pause", "media.paused"],
      ["waiting", "media.waiting"], ["seeking", "media.seeking"],
      ["ended", "media.ended"], ["error", "media.error"],
    ]) {
      on(refs.video, eventName, () => reportPlayerDiagnostic(session, type, {
        sceneId: session.currentTimeline?.clips?.[session.currentClipIndex]?.scene,
      }, eventName === "error" ? { reason: `media_error_${refs.video.error?.code ?? "unknown"}` } : {}));
    }
  }
  document.fonts.ready.then(() => {
    if (!listeners.signal.aborted && session.manifest) adapters.renderOverlays(true);
  });
  on(refs.input, "change", event => {
    void adapters.openPvo(event.target.files[0], { autoplay: true });
    event.target.value = "";
  });
  on(refs.endRestart, "click", () => { void adapters.restartExperience(true); });
  on(refs.retry, "click", adapters.retryResponse);
  bindPlaybackInputs({ refs, commands: adapters, signal: listeners.signal });
  on(refs.video, "volumechange", adapters.updateProgress);
  on(refs.video, "loadedmetadata", adapters.updateProgress);
  on(refs.video, "play", () => {
    updateRequestStatus(session, adapters.setStatus);
    adapters.updateProgress();
  });
  on(refs.video, "pause", adapters.updateProgress);
  on(refs.video, "timeupdate", () => {
    if (session.switchingClip || session.finished) return;
    adapters.renderOverlays();
    if (!adapters.handleResponseBoundary()) adapters.advanceAtClipEnd();
    adapters.updateProgress();
  });
  on(refs.video, "ended", () => adapters.advanceAtClipEnd(true));
  on(refs.overlay, "pvo-answer", event => { void adapters.answerComponent(event.detail); });
  on(refs.overlay, "pvo-field-answer", event => { void adapters.answerFieldComponent(event.detail); });
  on(refs.overlay, "pvo-form-submit", event => { void adapters.submitFormComponent(event.detail); });

  for (const name of ["dragenter", "dragover", "dragleave", "drop"]) {
    on(refs.dropZone, name, event => {
      event.preventDefault();
      refs.dropZone.classList.toggle("is-dragging", name === "dragenter" || name === "dragover");
      if (name === "drop") void adapters.openPvo(event.dataTransfer.files[0], { autoplay: true });
    });
  }
  on(window, "pagehide", event => {
    if (event.persisted) return;
    listeners.abort();
    stopAnimationClock();
    session.projectLoadController?.abort();
    adapters.destroyCustomOverlays();
    adapters.revokeAssetUrls();
    adapters.destroyControls();
    adapters.destroyLayout();
  });
}
