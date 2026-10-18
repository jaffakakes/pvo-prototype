import { useEffect, useRef } from "react";
import { notify } from "../../state/notifications/notificationStore";

/** A picker owns one preview; replacing it or leaving the picker releases its media. */
export function useSoundPreview() {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return (start: () => () => void) => {
    stop.current?.();
    try {
      stop.current = start();
    } catch {
      stop.current = null;
      notify("audioPreviewFailed");
    }
  };
}
