import { createPlaybackSession } from "./playback/session.js";
import { readPlayerElements } from "./ui/elements.js";
import { registerComponentView } from "./components/legacy-view.js";
import { createTimelineReader } from "./playback/timeline.js";
import { createComponentQueries } from "./components/visibility.js";
import { createOverlayRenderer } from "./components/overlays.js";
import { createVideoController } from "./media/video.js";
import { createProjectLoader } from "./media/project.js";
import { createPlayerControls } from "./ui/controls.js";
import { createActionRuntimeAdapter } from "./actions/runtime.js";
import { createComponentActions } from "./actions/components.js";
import { createOutcomeRouter } from "./actions/outcomes.js";
import { createPlaybackTransitions } from "./playback/transitions.js";
import { bindPlayerEvents } from "./ui/events.js";
import { readPublication } from "./publication/metadata.js";

const session = createPlaybackSession();
const refs = readPlayerElements();
const publication = readPublication(document.body.dataset, window.location.href,
  document.querySelector('link[rel="canonical"]')?.href);
registerComponentView();

const timeline = createTimelineReader({
  session,
  readMediaTime: () => refs.video.currentTime,
});

const visibility = createComponentQueries({
  session,
  adapters: {
    activeClip: (...args) => timeline.activeClip(...args),
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    localClipTime: (...args) => timeline.localClipTime(...args),
  },
});

const overlays = createOverlayRenderer({
  session,
  refs: { frame: refs.frame, overlay: refs.overlay, video: refs.video },
  adapters: {
    visibleComponents: (...args) => visibility.visibleComponents(...args),
    activeClip: (...args) => timeline.activeClip(...args),
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    handleCustomAction: (...args) => actions.handleCustomAction(...args),
    setStatus: (...args) => controls.setStatus(...args),
  },
});

const media = createVideoController({
  session,
  refs: { video: refs.video },
  adapters: {
    updateTimelineLabel: (...args) => controls.updateTimelineLabel(...args),
    finishExperience: (...args) => playback.finishExperience(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    updateProgress: (...args) => controls.updateProgress(...args),
    setStatus: (...args) => controls.setStatus(...args),
    showControls: (...args) => controls.showControls(...args),
    clipAtElapsedTime: (...args) => timeline.clipAtElapsedTime(...args),
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    activeClip: (...args) => timeline.activeClip(...args),
    replaceActionRuntime: (...args) => runtime.replaceActionRuntime(...args),
    dispatchCapturedResponse: (...args) => actions.dispatchCapturedResponse(...args),
    captureAboveVideo: (...args) => visibility.captureAboveVideo(...args),
  },
});

const project = createProjectLoader({
  session,
  refs: { frame: refs.frame, empty: refs.empty, shell: refs.shell, video: refs.video },
  adapters: {
    setStatus: (...args) => controls.setStatus(...args),
    destroyCustomOverlays: (...args) => overlays.destroyCustomOverlays(...args),
    makeActionRuntime: (...args) => runtime.makeActionRuntime(...args),
    restartExperience: (...args) => playback.restartExperience(...args),
    showControls: (...args) => controls.showControls(...args),
  },
});

const controls = createPlayerControls({
  session,
  publication,
  refs: {
    status: refs.status,
    progress: refs.progress,
    time: refs.time,
    video: refs.video,
    play: refs.play,
    mute: refs.mute,
    volume: refs.volume,
    centerPlay: refs.centerPlay,
    frame: refs.frame,
    timeline: refs.timeline,
    share: refs.share,
    endShare: refs.endShare,
  },
  adapters: {
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    timelineDuration: (...args) => timeline.timelineDuration(...args),
    restartExperience: (...args) => playback.restartExperience(...args),
  },
});

const runtime = createActionRuntimeAdapter({
  session,
  refs: { frame: refs.frame },
  adapters: {
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    updateRuntimeState: (...args) => overlays.updateRuntimeState(...args),
    activeClip: (...args) => timeline.activeClip(...args),
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    setStatus: (...args) => controls.setStatus(...args),
  },
});

const actions = createComponentActions({
  session,
  adapters: {
    setComponentPending: (...args) => overlays.setComponentPending(...args),
    captureOutcome: (...args) => outcomes.captureOutcome(...args),
    applyActionOutcome: (...args) => outcomes.applyActionOutcome(...args),
    setStatus: (...args) => controls.setStatus(...args),
    visibleComponents: (...args) => visibility.visibleComponents(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    updateComponentResponse: (...args) => overlays.updateComponentResponse(...args),
  },
});

const outcomes = createOutcomeRouter({
  session,
  refs: { video: refs.video, endScreen: refs.endScreen },
  adapters: {
    captureTimelineForScene: (...args) => timeline.captureTimelineForScene(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    loadClip: (...args) => media.loadClip(...args),
    seekToElapsed: (...args) => media.seekToElapsed(...args),
    showControls: (...args) => controls.showControls(...args),
    replaceActionRuntime: (...args) => runtime.replaceActionRuntime(...args),
    setStatus: (...args) => controls.setStatus(...args),
  },
});

const playback = createPlaybackTransitions({
  session,
  refs: { video: refs.video, endScreen: refs.endScreen },
  adapters: {
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    componentsForClip: (...args) => visibility.componentsForClip(...args),
    captureAboveVideo: (...args) => visibility.captureAboveVideo(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    updateProgress: (...args) => controls.updateProgress(...args),
    setStatus: (...args) => controls.setStatus(...args),
    showControls: (...args) => controls.showControls(...args),
    timelineById: (...args) => timeline.timelineById(...args),
    loadClip: (...args) => media.loadClip(...args),
    localClipTime: (...args) => timeline.localClipTime(...args),
    activeClip: (...args) => timeline.activeClip(...args),
    dispatchCapturedResponse: (...args) => actions.dispatchCapturedResponse(...args),
    replaceActionRuntime: (...args) => runtime.replaceActionRuntime(...args),
  },
});

bindPlayerEvents({
  session,
  refs,
  adapters: {
    openPvo: (...args) => project.openPvo(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    togglePlayback: (...args) => controls.togglePlayback(...args),
    restartExperience: (...args) => playback.restartExperience(...args),
    updateProgress: (...args) => controls.updateProgress(...args),
    showControls: (...args) => controls.showControls(...args),
    seekToElapsed: (...args) => media.seekToElapsed(...args),
    toggleFullscreen: (...args) => controls.toggleFullscreen(...args),
    shareExperience: (...args) => controls.shareExperience(...args),
    setStatus: (...args) => controls.setStatus(...args),
    handleResponseBoundary: (...args) => playback.handleResponseBoundary(...args),
    advanceAtClipEnd: (...args) => playback.advanceAtClipEnd(...args),
    answerComponent: (...args) => actions.answerComponent(...args),
    answerFieldComponent: (...args) => actions.answerFieldComponent(...args),
    submitFormComponent: (...args) => actions.submitFormComponent(...args),
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    destroyCustomOverlays: (...args) => overlays.destroyCustomOverlays(...args),
    revokeAssetUrls: (...args) => project.revokeAssetUrls(...args),
    destroyControls: () => controls.destroy(),
  },
});

const requestedSource = publication?.mediaUrl
  || new URLSearchParams(window.location.search).get("src") || document.body.dataset.pvoSrc;
if (requestedSource) {
  const autoplay = document.body.dataset.autoplay !== "false";
  refs.empty.hidden = true;
  refs.shell.hidden = false;
  if (autoplay) refs.video.muted = true;
  controls.updateProgress();
  void project.openPvoUrl(requestedSource, { autoplay });
}
