import { useEffect, useRef, type RefObject } from "react";

const controls = "button, input, textarea, select, label, a, [role='separator'], [role='dialog']:not(.sheet), [contenteditable], .orbAssistant, .compOverlay, .textOverlay, .tlClips, .textBar, .compBar, .layerName";
const tapTolerance = 12;

/** Dismiss only a blank-space tap, never a scrub, resize, or multi-touch gesture. */
export function useOutsideSelection(workspace: RefObject<HTMLDivElement>, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const app = workspace.current?.closest(".app");
    if (!app) return;
    const document = app.ownerDocument;
    let tap: { id: number; x: number; y: number; dismiss(): void } | null = null;
    const cancel = () => { tap = null; };
    const down = (event: PointerEvent) => {
      const target = event.target;
      if (!event.isPrimary || event.button !== 0 || !(target instanceof Element)
        || !app.contains(target)) { cancel(); return; }
      tap = target.closest(controls) ? null
        : { id: event.pointerId, x: event.clientX, y: event.clientY, dismiss: dismiss.current };
    };
    const move = (event: PointerEvent) => {
      if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > tapTolerance) cancel();
    };
    const up = (event: PointerEvent) => {
      const start = tap;
      cancel();
      // A surface may close on pointerdown; retain the interaction context that began this tap.
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= tapTolerance) start.dismiss();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [workspace]);
}
