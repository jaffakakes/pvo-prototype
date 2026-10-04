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
import { mountPlayerShell } from "./ui/shell.js";
import { createPlayerLayout } from "./ui/layout.js";

mountPlayerShell();
const session = createPlaybackSession();
const refs = readPlayerElements();
refs.video.muted = true;
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
    componentCanReceiveResponse: (...args) => visibility.componentCanReceiveResponse(...args),
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
  refs,
  adapters: {
    elapsedTime: (...args) => timeline.elapsedTime(...args),
    timelineDuration: (...args) => timeline.timelineDuration(...args),
    visibleComponents: (...args) => visibility.visibleComponents(...args),
    updateLayout: () => layout.update(),
    dispatchCapturedResponse: (...args) => actions.dispatchCapturedResponse(...args),
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
    pauseForComponentRequest: (...args) => playback.pauseForComponentRequest(...args),
  },
});

const actions = createComponentActions({
  session,
  adapters: {
    componentCanReceiveResponse: (...args) => visibility.componentCanReceiveResponse(...args),
    releaseUnavailableResponse: (...args) => playback.releaseUnavailableResponse(...args),
    setComponentPending: (...args) => {
      overlays.setComponentPending(...args);
      controls.updateProgress();
    },
    captureOutcome: (...args) => outcomes.captureOutcome(...args),
    applyActionOutcome: (...args) => outcomes.applyActionOutcome(...args),
    setStatus: (...args) => controls.setStatus(...args),
    visibleComponents: (...args) => visibility.visibleComponents(...args),
    renderOverlays: (...args) => overlays.renderOverlays(...args),
    updateComponentResponse: (...args) => {
      overlays.updateComponentResponse(...args);
      controls.updateProgress();
    },
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
    componentCanReceiveResponse: (...args) => visibility.componentCanReceiveResponse(...args),
    visibleComponents: (...args) => visibility.visibleComponents(...args),
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

const layout = createPlayerLayout({ refs, session });

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
    toggleMute: () => controls.toggleMute(),
    retryResponse: () => controls.retryResponse(),
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
    destroyLayout: () => layout.destroy(),
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
