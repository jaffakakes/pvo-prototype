import { useEffect } from "react";
import { locate, total } from "../../domain/clips/timing";
import { mediaOwnsDiagnosticClock, observedMediaEvent } from "../../domain/debugging/media";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { observeTryDiagnostics } from "./tryMode";

/** Observe the currently mounted video, including a final-frame hold and a replaced media element. */
export function useTryMediaDiagnostics(videoRef: React.RefObject<HTMLVideoElement>, trying: boolean, hasMedia: boolean): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!trying || !hasMedia || !video) return;
    const observe = observeTryDiagnostics();
    let lastObservation = "";
    const sample = (waiting = false, reason?: string) => {
      if (videoRef.current !== video) return;
      const state = useCapture.getState();
      const position = locate(state.t, state.clips);
      if (!mediaOwnsDiagnosticClock(state.t, total(state.clips), sceneDuration(state), !!position?.c.url)) return;
      // A source-switch event from the old video must not describe the newly selected clip.
      if (video.getAttribute("data-url") !== position?.c.url) return;
      const type = observedMediaEvent({ paused: video.paused, seeking: video.seeking, ended: video.ended,
        readyState: video.readyState, failed: !!video.error }, waiting);
      const observation = `${type}:${reason ?? ""}`;
      if (observation === lastObservation) return;
      lastObservation = observation;
      observe({ type, reason });
    };
    const events = {
      playing: () => sample(), pause: () => sample(), seeking: () => sample(), ended: () => sample(),
      error: () => sample(false, "media_error"),
      waiting: () => sample(true), stalled: () => sample(true, "stalled"),
      loadedmetadata: () => sample(), loadeddata: () => sample(), canplay: () => sample(), seeked: () => sample(),
    };
    for (const [name, listener] of Object.entries(events)) video.addEventListener(name, listener);
    sample();
    return () => { for (const [name, listener] of Object.entries(events)) video.removeEventListener(name, listener); };
  }, [videoRef, trying, hasMedia]);
}
