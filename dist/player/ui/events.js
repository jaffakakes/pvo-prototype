/** Translate shell and media events into the application's named commands. */
export function bindPlayerEvents({ session, refs, adapters }) {
  function handleInput(event) {
    const [file] = event.target.files;
    void adapters.openPvo(file, { autoplay: true });
    event.target.value = "";
  }

  document.fonts.ready.then(() => { if (session.manifest) adapters.renderOverlays(true); });

  window.addEventListener("resize", () => { if (session.manifest) adapters.renderOverlays(true); });

  refs.input?.addEventListener("change", handleInput);

  refs.play.addEventListener("click", adapters.togglePlayback);

  refs.centerPlay.addEventListener("click", adapters.togglePlayback);

  refs.restart.addEventListener("click", () => { void adapters.restartExperience(true); });

  refs.endRestart.addEventListener("click", () => { void adapters.restartExperience(true); });

  refs.mute.addEventListener("click", () => {
    refs.video.muted = !refs.video.muted;
    adapters.updateProgress();
    adapters.showControls();
  });

  refs.volume?.addEventListener("input", () => {
    refs.video.volume = Number(refs.volume.value);
    refs.video.muted = refs.video.volume === 0;
    adapters.updateProgress();
    adapters.showControls(true);
  });

  refs.progress.addEventListener("pointerdown", () => {
    session.resumeAfterScrub = !refs.video.paused;
    refs.video.pause();
    adapters.showControls(true);
  });

  refs.progress.addEventListener("input", () => { void adapters.seekToElapsed(Number(refs.progress.value)); });

  refs.progress.addEventListener("change", () => {
    const shouldResume = session.resumeAfterScrub;
    session.resumeAfterScrub = false;
    void adapters.seekToElapsed(Number(refs.progress.value), shouldResume);
    adapters.showControls();
  });

  refs.fullscreen.addEventListener("click", () => { void adapters.toggleFullscreen(); });

  refs.share?.addEventListener("click", () => { void adapters.shareExperience(); });

  refs.endShare?.addEventListener("click", () => { void adapters.shareExperience(); });

  refs.video.addEventListener("click", adapters.togglePlayback);

  refs.video.addEventListener("play", () => {
    adapters.setStatus("");
    adapters.updateProgress();
    adapters.showControls(false);
  });

  refs.video.addEventListener("pause", () => {
    adapters.updateProgress();
    if (!session.switchingClip) adapters.showControls();
  });

  refs.video.addEventListener("timeupdate", () => {
    if (session.switchingClip || session.finished) return;
    adapters.renderOverlays();
    adapters.updateProgress();
    if (!adapters.branchAtCurrentTime()) adapters.advanceAtClipEnd();
  });

  refs.video.addEventListener("ended", () => adapters.advanceAtClipEnd(true));

  refs.overlay.addEventListener("pvo-answer", (event) => {
    void adapters.answerComponent(event.detail);
  });

  refs.overlay.addEventListener("pvo-field-answer", (event) => {
    void adapters.answerFieldComponent(event.detail);
  });

  refs.overlay.addEventListener("pvo-form-submit", (event) => {
    void adapters.submitFormComponent(event.detail);
  });

  ["pointermove", "pointerdown", "touchstart"].forEach((eventName) => refs.frame.addEventListener(eventName, () => adapters.showControls(), { passive: true }));

  refs.frame.addEventListener("focusin", () => adapters.showControls(true));

  refs.frame.addEventListener("focusout", () => adapters.showControls());

  document.addEventListener("keydown", (event) => {
    if (refs.shell.hidden) return;
    if (event.composedPath().some((node) => ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(node?.tagName))) return;
    const key = event.key.toLowerCase();
    if (![" ", "arrowleft", "arrowright", "m", "f", "r"].includes(key)) return;
    event.preventDefault();
    adapters.showControls();
    if (key === " ") adapters.togglePlayback();
    else if (key === "arrowleft") void adapters.seekToElapsed(adapters.elapsedTime() - 5, !refs.video.paused);
    else if (key === "arrowright") void adapters.seekToElapsed(adapters.elapsedTime() + 5, !refs.video.paused);
    else if (key === "m") refs.mute.click();
    else if (key === "f") void adapters.toggleFullscreen();
    else if (key === "r") void adapters.restartExperience(true);
  });

  document.addEventListener("fullscreenchange", () => {
    const expanded = Boolean(document.fullscreenElement);
    refs.fullscreen.textContent = expanded ? "✕" : "⛶";
    refs.fullscreen.setAttribute("aria-label", expanded ? "Exit full screen" : "Enter full screen");
    adapters.showControls();
  });

  ["dragenter", "dragover"].forEach((eventName) => refs.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    refs.dropZone.classList.add("is-dragging");
  }));

  ["dragleave", "drop"].forEach((eventName) => refs.dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    refs.dropZone.classList.remove("is-dragging");
  }));

  refs.dropZone?.addEventListener("drop", (event) => { void adapters.openPvo(event.dataTransfer.files[0], { autoplay: true }); });

  window.addEventListener("beforeunload", () => {
    adapters.destroyCustomOverlays();
    adapters.revokeAssetUrls();
    adapters.destroyControls();
  });
}
