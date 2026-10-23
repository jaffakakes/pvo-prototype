let diagnosticSessionSequence = 0;

/** Per-viewer playback and resource state, owned by the application composition. */
export function createPlaybackSession({
  onDiagnostic,
  captureDiagnosticBodies,
} = {}) {
  return {
    onDiagnostic,
    captureDiagnosticBodies,
    diagnosticId: `player-${++diagnosticSessionSequence}`,
    diagnosticSequence: 0,
    manifest: null,
    assets: new Map(),
    assetUrls: new Map(),
    currentTimeline: null,
    currentClipIndex: 0,
    switchingClip: false,
    loadToken: 0,
    projectLoadSequence: 0,
    projectLoadController: null,
    awaitingComponent: null,
    finished: false,
    capturedResponses: new Map(),
    handledResponses: new Set(),
    deferredContinueSeekId: null,
    playbackRouteRevision: 0,
    seekSequence: 0,
    interactionEpoch: 0,
    interactionSequence: 0,
    interactionOperations: new Map(),
    renderedOverlayKey: "",
    runtimeStateRevision: 0,
    overlayResetRevision: 0,
    captureMode: false,
    pvoLanguageSources: new Map(),
    serviceConnections: new Map(),
    mountedCustom: new Map(),
    actionRuntime: null,
    forcedVisible: new Set(),
    forcedHidden: new Set(),
    pendingComponents: new Set(),
    pendingRequestComponents: new Set(),
    failedRequestComponents: new Map(),
  };
}

export const POST_OUTCOME_EPSILON = 0.001;
