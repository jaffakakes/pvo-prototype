import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import { total } from "../../domain/clips/timing";
import { round2 } from "../../domain/project/numbers";
import { projectRatio } from "../../domain/project/ratio";
import { useCapture } from "../../state/captureStore";
import { mkClip } from "../../state/editing/clipFactory";
import { getCameraStream } from "./useCamera";
import { reportRecordingFailure } from "./recordingIssues";

const HOLD_MS = 450;
export function useRecorder() {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const active = useRef(false);
  const expectedFootage = useRef(false);
  const recordingFailure = useRef<string | null>(null);
  const holdable = useRef(false);
  const tick = useRef<number | undefined>(undefined);
  const countdownTick = useRef<number | undefined>(undefined);
  const stopRec = useCallback(() => {
    if (!active.current)
      return;
    active.current = false;
    holdable.current = false;
    clearInterval(tick.current);
    const s = useCapture.getState();
    const real = Math.max(.3, (performance.now() - startedAt.current) / 1000);
    const [width, height] = projectRatio(s.ratio);
    const clip = mkClip(round2(real), null, s.clips.length, width, height, "cover");
    clip.speed = s.recSpeed;
    clip.mirror = s.facing === "user" && !!getCameraStream();
    const finish = () => {
      const state = useCapture.getState();
      const index = state.replacing != null ? state.clips.findIndex(c => c.id === state.replacing) : -1;
      if (index >= 0) {
        clip.color = state.clips[index].color;
        const clips = state.clips.map((c, i) => i === index ? clip : c);
        const before = total(clips.slice(0, index));
        state.edit({ clips, replacing: null, screen: "editor", sel: index, t: before, recording: false, elapsed: 0 });
      }
      else
        state.edit({ clips: [...state.clips, clip], replacing: null, recording: false, elapsed: 0 });
      if (expectedFootage.current && (!clip.url || recordingFailure.current)) {
        reportRecordingFailure(clip.id, recordingFailure.current
          ?? "No footage was captured for this clip. Record it again or remove the placeholder.");
      }
    };
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      const parts = chunks.current;
      let done = false;
      const save = () => {
        if (done)
          return;
        done = true;
        clearTimeout(guard);
        const blob = new Blob(parts, { type: rec.mimeType || "video/webm" });
        if (blob.size)
          clip.url = URL.createObjectURL(blob);
        finish();
      };
      const guard = window.setTimeout(save, 1500);
      rec.onstop = save;
      rec.onerror = () => {
        recordingFailure.current = "The recording was interrupted. Review the footage and record this clip again.";
        save();
      };
      try {
        rec.stop();
      }
      catch {
        save();
      }
    }
    else
      finish();
  }, []);
  const startRec = useCallback((isHold: boolean) => {
    const s = useCapture.getState();
    if (active.current || s.recording)
      return;
    startedAt.current = performance.now();
    active.current = true;
    holdable.current = isHold;
    chunks.current = [];
    recorder.current = null;
    const stream = getCameraStream();
    expectedFootage.current = !!stream;
    recordingFailure.current = stream && !window.MediaRecorder
      ? "This browser could not start video recording. Upload a video or use another browser." : null;
    if (stream && window.MediaRecorder) {
      try {
        const preferred = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
        const rec = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
        rec.ondataavailable = e => {
          if (e.data.size)
            chunks.current.push(e.data);
        };
        rec.onerror = () => {
          recordingFailure.current = "The recording was interrupted. Review the footage and record this clip again.";
        };
        rec.start(100);
        recorder.current = rec;
      }
      catch {
        recorder.current = null;
        recordingFailure.current = "The camera recorder could not start. Try another take or upload a video.";
      }
    }
    s.patch({ recording: true, elapsed: 0, speedRow: false, ratioMenu: false });
    tick.current = window.setInterval(() => {
      const current = useCapture.getState();
      const elapsed = (performance.now() - startedAt.current) / 1000 / current.recSpeed;
      current.patch({ elapsed });
    }, 100);
  }, [stopRec]);
  const cancelCountdown = useCallback(() => {
    clearInterval(countdownTick.current);
    useCapture.getState().patch({ countdown: 0 });
  }, []);
  const onShutterDown = useCallback((event: ReactPointerEvent | {
    button: number;
  }) => {
    if (event.button > 0)
      return;
    if ("currentTarget" in event)
      event.currentTarget.setPointerCapture(event.pointerId);
    const s = useCapture.getState();
    if (s.countdown) {
      cancelCountdown();
      return;
    }
    if (active.current || s.recording) {
      stopRec();
      return;
    }
    if (s.timer) {
      let remaining = s.timer;
      s.patch({ countdown: remaining });
      countdownTick.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          cancelCountdown();
          startRec(false);
        }
        else
          useCapture.getState().patch({ countdown: remaining });
      }, 1000);
    }
    else
      startRec(true);
  }, [cancelCountdown, startRec, stopRec]);
  const onShutterUp = useCallback(() => {
    if (active.current && holdable.current && performance.now() - startedAt.current > HOLD_MS)
      stopRec();
    holdable.current = false;
  }, [stopRec]);
  useEffect(() => () => {
    clearInterval(tick.current);
    clearInterval(countdownTick.current);
    if (recorder.current?.state === "recording")
      recorder.current.stop();
  }, []);
  return { onShutterDown, onShutterUp, stopRec, cancelCountdown };
}
