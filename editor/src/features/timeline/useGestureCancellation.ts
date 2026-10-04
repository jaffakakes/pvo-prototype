import { useEffect, useRef } from "react";

/** All timing entry points cancel on the same window and component lifetimes. */
export function useGestureCancellation(cancel: () => boolean) {
  const latest = useRef(cancel);
  latest.current = cancel;
  useEffect(() => {
    const stop = () => {
      latest.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !latest.current()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", stop);
    };
  }, []);
}
