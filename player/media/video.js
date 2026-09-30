import { invalidateActionOperations, reconcileResponseProgress } from "../actions/operations.js";
import { updateRequestStatus } from "../actions/request-status.js";

/** Own media-element loading and seeking; playback rules and UI arrive as ports. */
export function createVideoController({ session, refs, adapters }) {
  const seekIsCurrent = (operation) => operation.id === session.seekSequence
    && operation.routeRevision === session.playbackRouteRevision;

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

  async function performSeek(value, autoplay, options, operation) {
    if (!seekIsCurrent(operation)) return;
    if (!session.currentTimeline || session.finished || session.awaitingComponent) return;
    const currentElapsed = adapters.elapsedTime();
    const target = adapters.clipAtElapsedTime(value);
    if (!target) return;
    if (invalidateActionOperations(session)) {
      adapters.replaceActionRuntime(true);
      adapters.setStatus("");
    }
    const crossedBoundaries = reconcileResponseProgress(session, currentElapsed, target.elapsed, {
      responseBoundaries: options.responseBoundaries,
      isBoundaryEligible: (component) => !session.forcedHidden.has(component.id)
        && adapters.captureAboveVideo(component),
    });
    if (crossedBoundaries.length) {
      const crossing = crossedBoundaries[0];
      const component = session.manifest?.components?.find((item) => item.id === crossing.componentId);
      const boundary = adapters.clipAtElapsedTime(crossing.boundary);
      if (component && boundary) {
        if (boundary.index !== session.currentClipIndex) await loadClip(boundary.index, false);
        if (!seekIsCurrent(operation)) return;
        const boundaryClip = adapters.activeClip();
        if (!boundaryClip) return;
        refs.video.pause();
        refs.video.currentTime = Math.min(
          boundaryClip.end - (session.captureMode ? .001 : .01),
          boundaryClip.start + boundary.local,
        );
        session.awaitingComponent = component;
        session.renderedOverlayKey = "";
        adapters.renderOverlays(true);
        adapters.updateProgress();
        if (crossing.work === "wait") {
          adapters.setStatus(component.kind === "form" ? "Submit to continue" : "Choose to continue", false, true);
          adapters.showControls();
          return;
        }
        adapters.setStatus("Applying response…", false, true);
        session.deferredContinueSeekId = operation.id;
        try {
          await adapters.dispatchCapturedResponse(component.id);
        } finally {
          if (session.deferredContinueSeekId === operation.id) session.deferredContinueSeekId = null;
        }
        if (!seekIsCurrent(operation) || session.finished || session.awaitingComponent) return;
        updateRequestStatus(session, adapters.setStatus);
        return performSeek(target.elapsed, autoplay, options, operation);
      }
    }
    if (target.index !== session.currentClipIndex) await loadClip(target.index, false);
    if (!seekIsCurrent(operation)) return;
    const clip = adapters.activeClip();
    if (!clip) return;
    refs.video.currentTime = Math.min(clip.end - (session.captureMode ? .001 : .01), clip.start + target.local);
    session.renderedOverlayKey = "";
    adapters.renderOverlays(true);
    adapters.updateProgress();
    if (autoplay && seekIsCurrent(operation)) await refs.video.play().catch(() => adapters.showControls());
  }

  async function seekToElapsed(value, autoplay = false, options = {}) {
    if (!session.currentTimeline || session.finished || session.awaitingComponent) return;
    const operation = {
      id: ++session.seekSequence,
      routeRevision: session.playbackRouteRevision,
    };
    return performSeek(value, autoplay, {
      responseBoundaries: options.responseBoundaries === "skip" ? "skip" : "enforce",
    }, operation);
  }

  return { loadClip, seekToElapsed };
}
