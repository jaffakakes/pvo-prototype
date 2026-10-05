import { create } from "zustand";
import { useAuthGate } from "../auth/authGateStore";
import { useCapture } from "../captureStore";
import { clearNotificationScope } from "../notifications/notificationStore";
import { resetAssistant } from "./assistantStore";
import { resetAssistantThread } from "./threadStore";

type AssistantScope = {
  localId: string | null;
  ownerId: string | null;
  epoch: number;
};

export const useAssistantScope = create<AssistantScope>(() => ({
  localId: useCapture.getState().localId,
  ownerId: useAuthGate.getState().user?.id ?? null,
  epoch: 0,
}));

function syncScope() {
  const previous = useAssistantScope.getState();
  const localId = useCapture.getState().localId;
  const ownerId = useAuthGate.getState().user?.id ?? null;
  if (previous.localId === localId && previous.ownerId === ownerId) return;
  // The epoch also rejects a late response after switching away and back.
  useAssistantScope.setState({ localId, ownerId, epoch: previous.epoch + 1 });
  resetAssistant();
  resetAssistantThread();
  clearNotificationScope("assistant");
}

// These subscriptions belong to the application stores, not a mounted panel.
useCapture.subscribe(syncScope);
useAuthGate.subscribe(syncScope);
