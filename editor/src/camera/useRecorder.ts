import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { mkClip, useCapture } from "../store";
import { round2 } from "../lib/format";
import { total } from "../lib/timeline";
import { getCameraStream } from "./useCamera";

const HOLD_MS = 450;
export function useRecorder() {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const active = useRef(false);
  const holdable = useRef(false);
  const tick = useRef<number | undefined>(undefined);
  const countdownTick = useRef<number | undefined>(undefined);

  const stopRec = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    holdable.current = false;
    clearInterval(tick.current);
    const s = useCapture.getState();
    const real = Math.max(.3, (performance.now() - startedAt.current) / 1000);
    const maxTimeline = Math.max(.3, s.mode - total(s.clips.filter(c => c.id !== s.replacing)));
    const clip = mkClip(round2(Math.min(real, maxTimeline * s.recSpeed)), null, s.clips.length);
    clip.speed = s.recSpeed;
    clip.fx = s.liveFx;
    clip.mirror = s.facing === "user" && !!getCameraStream();
    const finish = () => {
      const state = useCapture.getState();
      if (state.replacing != null) {
        const index = state.clips.findIndex(c => c.id === state.replacing);
        if (index < 0) return;
        clip.color = state.clips[index].color;
        const clips = state.clips.map((c, i) => i === index ? clip : c);
        const before = total(clips.slice(0, index));
        state.edit({ clips, replacing: null, screen: "editor", sel: index, t: before, recording: false, elapsed: 0 });
      } else state.edit({ clips: [...state.clips, clip], recording: false, elapsed: 0 });
    };
    const rec = recorder.current;
    if (rec && rec.state === "recording") {
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || "video/webm" });
        if (blob.size) clip.url = URL.createObjectURL(blob);
        finish();
      };
      rec.stop();
    } else finish();
  }, []);

  const startRec = useCallback((isHold: boolean) => {
    const s = useCapture.getState();
    if (active.current || s.recording) return;
    startedAt.current = performance.now();
    active.current = true;
    holdable.current = isHold;
    chunks.current = [];
    recorder.current = null;
    const stream = getCameraStream();
    if (stream && window.MediaRecorder) {
      try {
        const rec = new MediaRecorder(stream);
        rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
        rec.start(100);
        recorder.current = rec;
      } catch { recorder.current = null; }
    }
    s.patch({ recording: true, elapsed: 0, speedRow: false });
    tick.current = window.setInterval(() => {
      const current = useCapture.getState();
      const elapsed = (performance.now() - startedAt.current) / 1000 / current.recSpeed;
      const used = total(current.clips.filter(c => c.id !== current.replacing));
      if (used + elapsed >= current.mode) stopRec();
      else current.patch({ elapsed });
    }, 100);
  }, [stopRec]);

  const cancelCountdown = useCallback(() => {
    clearInterval(countdownTick.current);
    useCapture.getState().patch({ countdown: 0 });
  }, []);

  const onShutterDown = useCallback((event: ReactPointerEvent | { button: number }) => {
    if (event.button > 0) return;
    if ("currentTarget" in event) event.currentTarget.setPointerCapture(event.pointerId);
    const s = useCapture.getState();
    if (s.countdown) { cancelCountdown(); return; }
    if (active.current || s.recording) { stopRec(); return; }
    const used = total(s.clips.filter(c => c.id !== s.replacing));
    if (used >= s.mode - .3) { s.notify("Time's up — open the editor"); return; }
    if (s.timer) {
      let remaining = s.timer;
      s.patch({ countdown: remaining });
      countdownTick.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) { cancelCountdown(); startRec(false); }
        else useCapture.getState().patch({ countdown: remaining });
      }, 1000);
    } else startRec(true);
  }, [cancelCountdown, startRec, stopRec]);

  const onShutterUp = useCallback(() => {
    if (active.current && holdable.current && performance.now() - startedAt.current > HOLD_MS) stopRec();
    holdable.current = false;
  }, [stopRec]);

  useEffect(() => () => {
    clearInterval(tick.current);
    clearInterval(countdownTick.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { onShutterDown, onShutterUp, stopRec, cancelCountdown };
}
