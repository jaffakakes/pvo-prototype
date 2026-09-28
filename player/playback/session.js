/** Per-viewer playback and resource state, owned by the application composition. */
export function createPlaybackSession() {
  return {
    manifest: null,
    assets: new Map(),
    assetUrls: new Map(),
    currentTimeline: null,
    currentClipIndex: 0,
    switchingClip: false,
    loadToken: 0,
    awaitingComponent: null,
    finished: false,
    answers: new Map(),
    handledBranches: new Set(),
    renderedOverlayKey: "",
    controlsTimer: null,
    resumeAfterScrub: false,
    captureMode: false,
    pvoLanguageSources: new Map(),
    mountedCustom: new Map(),
    actionRuntime: null,
    forcedVisible: new Set(),
    forcedHidden: new Set(),
    pendingComponents: new Set(),
  };
}

export const POST_OUTCOME_EPSILON = .001;
