import type { NativeOperation } from "../../../../packages/pvo-assistant/native/index.js";
import { appliedAssistantSummary } from "../../domain/assistant/appliedSummary";
import { nativeProjectFingerprint } from "../../domain/assistant/native/context";
import type { Notification } from "../../domain/notifications/policy";
import { useCapture } from "../captureStore";
import { dismissNotification, notify, useNotifications } from "../notifications/notificationStore";
import { projectSnapshot } from "../project/history";
import { useAssistant } from "./assistantStore";
import type { AppliedAssistantChange } from "./applyChanges";

let currentAction: { notification: Notification; change: AppliedAssistantChange } | null = null;
let unsubscribe: (() => void) | null = null;
function releaseAction() {
  unsubscribe?.();
  unsubscribe = null;
  currentAction = null;
}

/** Own one Undo receipt only while its notification is visible. */
export function notifyAssistantApplied(change: AppliedAssistantChange, operations: readonly NativeOperation[], operation: string) {
  releaseAction();
  notify("assistantApplied", { scope: "assistant", operation, currentAttempt: true,
    summary: appliedAssistantSummary(operations) });
  const notification = useNotifications.getState().current;
  if (notification?.id !== "assistantApplied" || notification.operation !== operation) return;
  currentAction = { notification, change };
  unsubscribe = useNotifications.subscribe(state => {
    if (state.current !== notification) releaseAction();
  });
}

/** An old toast can never undo a newer manual edit, another project or a redo. */
export function performNotificationAction(): boolean {
  const action = currentAction;
  if (!action || useNotifications.getState().current !== action.notification) return false;
  releaseAction();
  const state = useCapture.getState();
  const change = action.change;
  const allowed = state.screen === "editor" && !state.recording && !state.importing && !state.trim
    && !state.tryMode && !state.playheadPick && state.ex !== "running"
    && state.localId === change.localId && state.past === change.past && state.future === change.future
    && state.past.length > 0 && nativeProjectFingerprint(projectSnapshot(state)) === change.fingerprint;
  if (allowed) {
    state.undo();
    useAssistant.setState(current => ({ history: [...current.history,
      { role: "assistant" as const, content: "The user undid the previous assistant edit. Use the current project for the next request." }].slice(-12) }));
  }
  dismissNotification();
  return allowed;
}
