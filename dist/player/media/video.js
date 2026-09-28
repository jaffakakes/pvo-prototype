/** Own media-element loading and seeking; playback rules and UI arrive as ports. */
export function createVideoController({ session, refs, adapters }) {
  function waitForVideo(eventName, token) {
    return new Promise((resolve, reject) => {
      const onEvent = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("This media cannot be played in the browser.")); };
      const cleanup = () => {
        refs.video.removeEventListener(eventName, onEvent);
        refs.video.removeEventListener("error", onError);
      };
      refs.video.addEventListener(eventName, onEvent, { once: true });
      refs.video.addEventListener("error", onError, { once: true });
      if (token !== session.loadToken) { cleanup(); resolve(); }
    });
  }

  async function loadClip(index, autoplay = false) {
    const clip = session.currentTimeline?.clips?.[index];
    if (!clip) return adapters.finishExperience();
    const asset = session.assets.get(clip.asset_id);
    const url = session.assetUrls.get(clip.asset_id);
    if (!asset || !url) throw new Error(`PVO media "${clip.asset_id}" is missing.`);
    const token = ++session.loadToken;
    session.switchingClip = true;
    refs.video.pause();
    session.currentClipIndex = index;
    session.renderedOverlayKey = "";
    adapters.updateTimelineLabel(session.currentTimeline);
    if (refs.video.dataset.assetId !== clip.asset_id) {
      refs.video.dataset.assetId = clip.asset_id;
      refs.video.src = url;
      refs.video.load();
      await waitForVideo("loadedmetadata", token);
    }
    if (token !== session.loadToken) return;
    refs.video.currentTime = Math.max(0, clip.start);
    session.switchingClip = false;
    adapters.renderOverlays(true);
    adapters.updateProgress();
    if (autoplay) {
      await refs.video.play().catch(() => {
        adapters.setStatus("Tap to play", false, true);
        adapters.showControls();
      });
    }
  }

  async function seekToElapsed(value, autoplay = false) {
    if (!session.currentTimeline || session.finished || session.awaitingComponent) return;
    const target = adapters.clipAtElapsedTime(value);
    if (!target) return;
    if (target.index !== session.currentClipIndex) await loadClip(target.index, false);
    const clip = adapters.activeClip();
    if (!clip) return;
    refs.video.currentTime = Math.min(clip.end - (session.captureMode ? .001 : .01), clip.start + target.local);
    session.renderedOverlayKey = "";
    adapters.renderOverlays(true);
    adapters.updateProgress();
    if (autoplay) await refs.video.play().catch(() => adapters.showControls());
  }

  return { loadClip, seekToElapsed };
}
