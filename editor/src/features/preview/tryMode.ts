import { useCapture } from "../../state/captureStore";
import { clearNotificationScope, notify } from "../../state/notifications/notificationStore";
import { createTrySession } from "./createTrySession";
import {
  beginTryRequest,
  clearTryFeedback,
  finishTryRequest,
  reportEmptyScene,
  useTryFeedback,
} from "./tryFeedbackStore";
import { clearTryRuntimeState, publishTryRuntimeState } from "./tryRuntimeStateStore";

// The application owns one preview session; each factory instance owns its own runtime.
const session = createTrySession({
  getState: useCapture.getState,
  request: (...args) => fetch(...args),
  publishRuntimeState: state => {
    if (state) publishTryRuntimeState(state);
    else clearTryRuntimeState();
  },
  feedback: () => useTryFeedback.getState().components,
  clearFeedback: clearTryFeedback,
  clearNotice: () => clearNotificationScope("try"),
  startFailed: () => {
    notify("tryFailed", { scope: "try", currentAttempt: true });
  },
  emptyScene: reportEmptyScene,
  beginRequest: beginTryRequest,
  finishRequest: finishTryRequest,
});
export const {
  getTryRuntime,
  startTry,
  stopTry,
  runComponentResponse,
  runFormSubmission,
  advanceTry,
} = session;
