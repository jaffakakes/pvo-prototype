import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

type Session = { move(event: PointerEvent): void; finish(cancelled: boolean): void };

/** Own one gesture's listeners and always roll back failures, Escape and unmount. */
export function usePointerSession(onError: (error: unknown) => void) {
  const cleanup = useRef<(() => void) | null>(null);
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => () => cleanup.current?.(), []);
  return (event: ReactPointerEvent, begin: () => Session, immediate = false) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    let session: Session;
    try { session = begin(); }
    catch (error) { report.current(error); return; }
    const pointerId = event.pointerId;
    let ended = false;
    const move = (next: PointerEvent) => {
      if (ended || next.pointerId !== pointerId) return;
      try { session.move(next); }
      catch (error) { finish(true); report.current(error); }
    };
    const finish = (cancelled: boolean) => {
      if (ended) return;
      ended = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      cleanup.current = null;
      try { session.finish(cancelled); }
      catch (error) { report.current(error); }
    };
    const up = (next: PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
    const cancel = () => finish(true);
    const key = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return;
      next.preventDefault(); next.stopImmediatePropagation(); cancel();
    };
    cleanup.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    if (immediate) move(event.nativeEvent);
  };
}
