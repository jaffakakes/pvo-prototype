import { useEffect, useRef, useState } from "react";
import { locate, total } from "../../domain/clips/timing";
import { sceneDuration } from "../../domain/scenes/duration";
import type { Scene } from "../../domain/project/model";
import type { ExportView } from "./presentation";

type Options = {
  scene: Scene;
  mode: ExportView;
  pickerTime: number;
  onPickerTime(time: number): void;
  artifactId?: string;
};

/** Own both preview decoders and clocks, independently of the export renderer. */
export function useExportPreviewPlayback({
  scene,
  mode,
  pickerTime,
  onPickerTime,
  artifactId,
}: Options) {
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const resultVideo = useRef<HTMLVideoElement>(null);
  const clock = useRef(0);
  const playingRef = useRef(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const duration = sceneDuration(scene);
  const inResult = mode === "done" && resultReady;
  const shownTime = mode === "picker" ? pickerTime : time;
  const sourceTime = Math.min(shownTime, Math.max(0, duration - 0.001));
  const located =
    sourceTime < total(scene.clips) ? locate(sourceTime, scene.clips) : null;
  const clip = located?.c;

  useEffect(() => {
    if (mode !== "picker") return;
    setPlaying(false);
    clock.current = Math.max(0, Math.min(duration, pickerTime));
    setTime(clock.current);
    const position =
      clock.current < total(scene.clips)
        ? locate(clock.current, scene.clips)
        : null;
    if (
      position &&
      sourceVideo.current?.dataset.clipId === String(position.c.id)
    )
      sourceVideo.current.currentTime = position.lt;
  }, [mode, pickerTime, duration, scene.clips]);

  useEffect(() => {
    if (mode === "exporting") setMuted(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== "gate") return;
    const phone = window.matchMedia("(max-width: 700px)");
    const stopHiddenPreview = () => {
      if (!phone.matches) return;
      setPlaying(false);
      setMuted(true);
    };
    stopHiddenPreview();
    phone.addEventListener("change", stopHiddenPreview);
    return () => phone.removeEventListener("change", stopHiddenPreview);
  }, [mode]);

  useEffect(() => {
    if (mode !== "done") return;
    setPlaying(false);
    clock.current = 0;
    setTime(0);
    setResultReady(false);
  }, [mode, artifactId]);

  useEffect(() => {
    const video = sourceVideo.current;
    if (!video) return;
    video.pause();
    if (!clip?.url) {
      video.removeAttribute("src");
      video.removeAttribute("data-clip-id");
      video.load();
      return;
    }
    video.dataset.clipId = String(clip.id);
    video.src = clip.url;
    video.defaultPlaybackRate = clip.speed;
    video.load();
    video.playbackRate = clip.speed;
    const ready = () => {
      const now = clock.current;
      const position =
        now < total(scene.clips) ? locate(now, scene.clips) : null;
      video.currentTime = position?.c.id === clip.id ? position.lt : clip.in;
      if (playingRef.current && mode !== "picker" && mode !== "done")
        void video.play().catch(() => setPlaying(false));
    };
    video.addEventListener("loadedmetadata", ready);
    return () => {
      video.removeEventListener("loadedmetadata", ready);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [clip?.id, clip?.url, scene]);

  useEffect(() => {
    playingRef.current = playing;
    const target = inResult ? resultVideo.current : sourceVideo.current;
    if (!target) return;
    if (playing && mode !== "picker" && (inResult || clip?.url))
      void target.play().catch(() => setPlaying(false));
    else target.pause();
  }, [playing, inResult, clip?.id, clip?.url, mode]);

  useEffect(() => {
    if (
      !playing ||
      inResult ||
      clip?.url ||
      mode === "picker" ||
      mode === "done"
    )
      return;
    let previous = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      clock.current = Math.min(
        duration,
        clock.current + (now - previous) / 1000,
      );
      previous = now;
      setTime(clock.current);
      if (clock.current >= duration) setPlaying(false);
    }, 50);
    return () => clearInterval(interval);
  }, [playing, inResult, clip?.url, mode, duration]);

  const seek = (next: number) => {
    const bounded = Math.max(0, Math.min(duration, next));
    clock.current = bounded;
    setTime(bounded);
    if (mode === "picker") onPickerTime(bounded);
    if (inResult && resultVideo.current && resultVideo.current.readyState >= 1)
      resultVideo.current.currentTime = bounded;
    else {
      const position =
        bounded < total(scene.clips) ? locate(bounded, scene.clips) : null;
      if (
        position &&
        sourceVideo.current?.dataset.clipId === String(position.c.id) &&
        sourceVideo.current.readyState >= 1
      )
        sourceVideo.current.currentTime = position.lt;
    }
  };
  const togglePlay = () => {
    if (mode === "picker") return;
    if (!playing && time >= duration - 0.02) seek(0);
    setPlaying((value) => !value);
  };
  const sourcePosition = (video: HTMLVideoElement) => {
    if (
      !located ||
      video.dataset.clipId !== String(located.c.id) ||
      mode === "done" ||
      mode === "picker"
    )
      return;
    const next =
      located.start +
      Math.max(0, (video.currentTime - located.c.in) / located.c.speed);
    const boundary = located.start + located.d;
    clock.current =
      next >= boundary - 0.025 ? Math.min(duration, boundary + 0.001) : next;
    setTime(clock.current);
    if (clock.current >= duration - 0.01) setPlaying(false);
  };
  useEffect(() => {
    if (!playing || mode === "picker") return;
    let frame = 0;
    const update = () => {
      if (inResult && resultVideo.current) {
        clock.current = resultVideo.current.currentTime;
        setTime(clock.current);
      } else if (sourceVideo.current && clip?.url)
        sourcePosition(sourceVideo.current);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [
    playing,
    inResult,
    mode,
    clip?.id,
    clip?.url,
    clip?.in,
    clip?.speed,
    located?.start,
    located?.d,
    duration,
  ]);

  const sourceEnded = () => {
    if (!located) return;
    clock.current = Math.min(duration, located.start + located.d + 0.001);
    setTime(clock.current);
  };
  const resultPosition = (video: HTMLVideoElement) => {
    if (!inResult) return;
    clock.current = video.currentTime;
    setTime(clock.current);
  };
  const resultLoaded = () => {
    if (mode === "done") setResultReady(true);
  };
  return {
    sourceVideo,
    resultVideo,
    clip,
    located,
    duration,
    shownTime,
    inResult,
    playing,
    muted,
    seek,
    togglePlay,
    sourcePosition,
    sourceEnded,
    resultPosition,
    resultLoaded,
    stop: () => setPlaying(false),
    toggleMuted: () => setMuted((value) => !value),
  };
}
