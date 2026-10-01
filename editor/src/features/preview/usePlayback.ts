import { sceneDuration } from "../../domain/scenes/duration";
import { useEffect, useRef } from "react";
import { locate, total } from "../../domain/clips/timing";
import { clamp } from "../../domain/project/numbers";
import { useCapture } from "../../state/captureStore";
import type { CaptureState } from "../../state/types";
import { runPlaybackFrame } from "./playbackFrame";
import { advanceTry, failTry, observeTryDiagnostics } from "./tryMode";
import { useTryMediaDiagnostics } from "./useTryMediaDiagnostics";

const UPDATE_MS = 1000 / 30;
const SEEK_TOLERANCE = .015;
const END_TOLERANCE = .02;

type LoadedClip = { element: HTMLVideoElement; id: number; url: string; in: number; speed: number };

export function usePlayback(videoRef: React.RefObject<HTMLVideoElement>) {
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const lastPublished = useRef(0);
  const publishingVideoTime = useRef(false);
  const positionOrigin = useRef(new WeakMap<CaptureState, "video" | "external">());
  const loadedClip = useRef<LoadedClip | null>(null);
  const syntheticClockReported = useRef(false);
  const pausedAt = useRef<number | null>(null);
  const state = useCapture();
  const { clips, t, playing, muted, trim } = state;
  const trying = !!state.tryMode;
  const sceneTail = sceneDuration(state) > total(clips) && t >= total(clips);
  const current = trim ? { c: clips[trim.i], lt: trim.lt } : sceneTail ? null : locate(t, clips);
  const hasMedia = !!current?.c.url;
  useTryMediaDiagnostics(videoRef, trying, hasMedia);
  const fromVideo = positionOrigin.current.get(state) === "video";
  const pausePositionUnchanged = pausedAt.current != null && Math.abs(t - pausedAt.current) < .0001;
  const justPausedAtVideoTime = !playing && pausedAt.current == null && fromVideo;
  const explicitSeekTime = trim != null || state.tryMode?.holdingId != null ||
    (playing ? !fromVideo : !pausePositionUnchanged && !justPausedAtVideoTime)
    ? current?.lt : null;

  useEffect(() => useCapture.subscribe((next, previous) => {
    const origin = next.t === previous.t
      ? positionOrigin.current.get(previous) ?? "external"
      : publishingVideoTime.current ? "video" : "external";
    positionOrigin.current.set(next, origin);
  }), []);

  useEffect(() => () => {
    loadedClip.current?.element.pause();
  }, []);

  useEffect(() => {
    syntheticClockReported.current = false;
  }, [trying, hasMedia]);

  useEffect(() => {
    const video = videoRef.current;
    const clip = current?.c;
    if (!video || !clip?.url) {
      video?.pause();
      loadedClip.current = null;
      return;
    }

    const previous = loadedClip.current;
    const sourceChanged = previous?.element !== video || previous.url !== clip.url;
    const clipChanged = sourceChanged || previous.id !== clip.id || previous.in !== clip.in || previous.speed !== clip.speed;
    const localTime = current?.lt ?? clip.in;
    loadedClip.current = { element: video, id: clip.id, url: clip.url, in: clip.in, speed: clip.speed };
    pausedAt.current = playing ? null : t;
    // Store updates published by this video are observations, not seek requests.
    const shouldSeek = clipChanged || explicitSeekTime != null;
    let disposed = false;

    const resume = () => {
      if (!disposed && useCapture.getState().playing && video.paused) {
        const observe = observeTryDiagnostics();
        observe({ type: "media.play_requested" });
        video.play().catch(() => {
          if (!disposed) observe({ type: "media.play_rejected", reason: "play_rejected" });
        });
      }
    };
    const sync = () => {
      if (video.muted !== (muted || !!clip.audioDetached))
        video.muted = muted || !!clip.audioDetached;
      const speed = clamp(clip.speed, .25, 4);
      if (video.playbackRate !== speed)
        video.playbackRate = speed;
      if (!playing)
        video.pause();
      if (video.readyState < HTMLMediaElement.HAVE_METADATA)
        return;

      if (shouldSeek && Math.abs(video.currentTime - localTime) > SEEK_TOLERANCE)
        video.currentTime = localTime;
      if (playing) {
        // On iPhone a source or in-point seek can finish asynchronously. Do not
        // briefly play the old frame before the requested frame is available.
        if (video.seeking)
          video.addEventListener("seeked", resume, { once: true });
        else
          resume();
      }
    };

    if (sourceChanged) {
      video.setAttribute("data-url", clip.url);
      video.src = clip.url;
      video.load();
    }
    video.addEventListener("loadedmetadata", sync);
    sync();
    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("seeked", resume);
    };
  }, [videoRef, current?.c?.id, current?.c?.url, current?.c?.in, current?.c?.speed, current?.c?.audioDetached, explicitSeekTime, playing, muted]);

  useEffect(() => {
    if (!playing) {
      syntheticClockReported.current = false;
      cancelAnimationFrame(raf.current);
      lastFrame.current = 0;
      lastPublished.current = 0;
      return;
    }

    const frameFailure = {
      isTrying: () => !!useCapture.getState().tryMode,
      failTry,
      stopPlayback: (error: unknown) => {
        console.error("Preview playback stopped after a frame failure:", error);
        useCapture.getState().patch({ playing: false });
      },
    };
    function tick(time: number) {
      runPlaybackFrame(runFrame, time, videoRef.current, frameFailure);
    }
    const runFrame = (time: number) => {
      const dt = lastFrame.current ? Math.min(.1, (time - lastFrame.current) / 1000) : 0;
      lastFrame.current = time;
      const state = useCapture.getState();
      if (!state.playing)
        return;
      const position = state.t < total(state.clips) ? locate(state.t, state.clips) : null;
      const projectEnd = sceneDuration(state);

      let next: number;
      if (position?.c.url) {
        const video = videoRef.current;
        const active = loadedClip.current;
        if (!video || active?.element !== video || active.id !== position.c.id ||
          active.url !== position.c.url || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          (video.paused && !video.ended) || video.seeking) {
          raf.current = requestAnimationFrame(tick);
          return;
        }
        // The decoded media, not a second wall clock, owns time for real clips.
        next = position.start + clamp((video.currentTime - position.c.in) / position.c.speed, 0, position.d);
        if (video.ended || video.currentTime >= position.c.out - END_TOLERANCE)
          next = position.start + position.d;
      }
      else {
        // Camera-denied demo clips have no media clock.
        next = Math.min(position ? position.start + position.d : projectEnd, state.t + dt);
        if (state.tryMode && !syntheticClockReported.current) {
          syntheticClockReported.current = true;
          observeTryDiagnostics()({ type: "media.playing", reason: "timeline_clock" });
        }
      }

      if (advanceTry(state, next)) {
        if (useCapture.getState().playing)
          raf.current = requestAnimationFrame(tick);
        return;
      }
      if (next >= projectEnd - .0001) {
        publishingVideoTime.current = true;
        try { state.patch({ t: projectEnd, playing: false }); }
        finally { publishingVideoTime.current = false; }
        return;
      }

      const atClipBoundary = position && next >= position.start + position.d - .0001;
      if (atClipBoundary || time - lastPublished.current >= UPDATE_MS) {
        lastPublished.current = time;
        if (Math.abs(next - state.t) > .0001) {
          publishingVideoTime.current = true;
          try { state.patch({ t: next }); }
          finally { publishingVideoTime.current = false; }
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      lastFrame.current = 0;
      lastPublished.current = 0;
    };
  }, [playing, videoRef]);
}
