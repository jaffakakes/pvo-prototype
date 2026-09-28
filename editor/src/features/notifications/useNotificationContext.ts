import { useEffect } from "react";
import { notificationDefinition } from "../../domain/notifications/catalog";
import { useAssistant } from "../../state/assistant/assistantStore";
import { useCapture } from "../../state/captureStore";
import { dismissNotification, setNotificationsBusy, useNotifications } from "../../state/notifications/notificationStore";

/** Browser attention belongs to the host, outside the notification policy/store. */
export function useNotificationContext() {
  useEffect(() => {
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let active = true;
    let previous = useCapture.getState();
    const update = () => {
      if (!active) return;
      const capture = useCapture.getState();
      const current = useNotifications.getState().current;
      const changedContext = capture.screen !== previous.screen || capture.currentSceneId !== previous.currentSceneId
        || capture.sel !== previous.sel || capture.selComp !== previous.selComp || capture.selText !== previous.selText
        || capture.sheet !== previous.sheet || capture.tryMode !== previous.tryMode;
      if (current && !notificationDefinition(current.id).persistent && (changedContext
        || (current.id === "splitUnavailable" && capture.t !== previous.t))) dismissNotification();
      previous = capture;
      const phase = useAssistant.getState().phase;
      const typing = document.activeElement?.matches("input, textarea, [contenteditable='true']") ?? false;
      setNotificationsBusy(capture.recording || !!capture.trim || dragging || typing || phase !== "idle");
    };
    const down = (event: PointerEvent) => {
      if ((event.target as Element)?.closest("[data-notification-root]")) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const move = (event: PointerEvent) => {
      const start = pointers.get(event.pointerId);
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) {
        dragging = true; update();
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) dragging = false;
      update();
    };
    const blur = () => { pointers.clear(); dragging = false; update(); };
    const focusOut = () => queueMicrotask(update);
    const unsubscribeCapture = useCapture.subscribe(update);
    const unsubscribeAssistant = useAssistant.subscribe(update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", focusOut);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", blur);
    update();
    return () => {
      active = false;
      unsubscribeCapture(); unsubscribeAssistant();
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", focusOut);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", blur);
      setNotificationsBusy(false);
    };
  }, []);
}
