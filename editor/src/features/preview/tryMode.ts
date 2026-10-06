import { openServiceSubmissionStore } from "../../../../packages/pvo-assistant/attachments/index.js";
import { useAuthGate } from "../../state/auth/authGateStore";
import { useCapture } from "../../state/captureStore";
import {
  clearNotificationScope,
  notify,
} from "../../state/notifications/notificationStore";
import { createTrySession } from "./createTrySession";
import {
  beginTryRequest,
  clearTryFeedback,
  finishTryRequest,
  reportEmptyScene,
  useTryFeedback,
} from "./tryFeedbackStore";
import {
  clearTryRuntimeState,
  publishTryRuntimeState,
} from "./tryRuntimeStateStore";
import {
  publishDebugState,
  recordDebugEvent,
  startDebugRun,
  stopDebugRun,
  syncDebugContext,
  useTryDebugStore,
} from "../../state/debugging/tryDebugStore";

function debugInput(state: ReturnType<typeof useCapture.getState>) {
  return {
    projectId: state.localId,
    scenes: state.scenes.map((scene) =>
      scene.id === state.currentSceneId
        ? {
            ...scene,
            clips: state.clips,
            components: state.components,
            texts: state.texts,
            layers: state.layers,
          }
        : scene,
    ),
    sceneId: state.currentSceneId,
    videoTime: state.t,
    requested: state.playing,
    holdingId: state.tryMode?.holdingId ?? null,
    handledIds: state.tryMode?.handled,
    dispatchedIds: state.tryMode?.dispatched,
  };
}

// The application owns one preview session; each factory instance owns its own runtime.
const session = createTrySession({
  services: {
    scope: () => ({
      ownerId: useAuthGate.getState().user?.id ?? null,
      localId: useCapture.getState().localId,
      assistantTaskLinks: useCapture.getState().assistantTaskLinks,
      origin: window.location.origin,
    }),
    openStore: () => openServiceSubmissionStore(),
    createId: () => crypto.randomUUID(),
    request: (...args) => fetch(...args),
  },
  diagnostics: {
    start: (source) =>
      startDebugRun({
        ...debugInput(useCapture.getState()),
        videoTime: source.t,
        requested: true,
      }),
    stop: stopDebugRun,
    record: (runId, event, source) =>
      recordDebugEvent(runId, event, {
        sceneId: source.currentSceneId,
        sceneName:
          source.scenes.find((scene) => scene.id === source.currentSceneId)
            ?.name ?? "Scene",
        videoTime: source.t,
      }),
    state: publishDebugState,
    capture: () => useTryDebugStore.getState().captureData,
  },
  getState: useCapture.getState,
  request: (...args) => fetch(...args),
  publishRuntimeState: (state) => {
    if (state) publishTryRuntimeState(state);
    else clearTryRuntimeState();
  },
  feedback: () => useTryFeedback.getState().components,
  clearFeedback: clearTryFeedback,
  clearNotice: () => clearNotificationScope("try"),
  startFailed: () => {
    notify("tryFailed", { scope: "try", currentAttempt: true });
  },
  playbackFailed: () => {
    notify("tryPlaybackFailed", { scope: "try", currentAttempt: true });
  },
  emptyScene: reportEmptyScene,
  beginRequest: beginTryRequest,
  finishRequest: finishTryRequest,
});

// End private component interactions immediately when their account is replaced.
useAuthGate.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id && useCapture.getState().tryMode)
    session.stopTry();
});

// A project change discards the previous project's trace; ending Try retains its final position.
useCapture.subscribe((state, previous) => {
  if (!useTryDebugStore.getState().run) return;
  const sourceChanged =
    state.scenes !== previous.scenes ||
    state.components !== previous.components;
  syncDebugContext(debugInput(state), sourceChanged);
});
export const {
  beginComponentInteraction,
  recordTryDiagnostic,
  observeTryDiagnostics,
  getTryRuntime,
  startTry,
  stopTry,
  failTry,
  runComponentResponse,
  runFormSubmission,
  advanceTry,
} = session;
