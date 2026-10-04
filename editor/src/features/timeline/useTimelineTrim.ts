import { useRef, type PointerEvent } from "react";
import { dur, total } from "../../domain/clips/timing";
import type { Clip } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../../state/captureStore";
import { beginTimelineTimingDrag } from "../../state/editing/timelineTimingDrag";
import { PPS } from "./geometry";
import { snappedTimingDelta } from "./timingSnap";
import { useGestureCancellation } from "./useGestureCancellation";

type Gesture = {
  pointerId: number;
  element: Element;
  x: number;
  clip: Clip;
  side: "l" | "r";
  index: number;
  moved: boolean;
  edgeTime: number | null;
  playhead: number;
  timing: NonNullable<ReturnType<typeof beginTimelineTimingDrag>>;
};

/** Mobile trim geometry adapts the shared timing transaction to the fixed playhead. */
export function useTimelineTrim() {
  const gesture = useRef<Gesture | null>(null);
  const finish = (cancelled: boolean) => {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    const shift = useCapture.getState().trim?.shift ?? 0;
    const committed = !cancelled && active.timing.commit();
    if (cancelled) active.timing.cancel();
    const state = useCapture.getState();
    state.patch({
      trim: null,
      // Left trimming translates the strip beneath the stationary mobile playhead.
      ...(committed
        ? { t: clamp(active.playhead - shift / PPS, 0, sceneDuration(state)) }
        : {}),
    });
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return true;
  };
  useGestureCancellation(() => finish(true));

  return {
    trimDown(event: PointerEvent, index: number, side: "l" | "r") {
      event.stopPropagation();
      if (event.button > 0 || gesture.current) return;
      const state = useCapture.getState();
      const clip = state.clips[index];
      if (!clip) return;
      // Preserve mobile's continuous trim and existing 0.3-second minimum.
      const timing = beginTimelineTimingDrag(
        { kind: "clip", id: clip.id, mode: side },
        { minimumClipDuration: 0.3 },
      );
      if (!timing) return;
      gesture.current = {
        pointerId: event.pointerId,
        element: event.currentTarget,
        x: event.clientX,
        clip,
        side,
        index,
        moved: false,
        edgeTime: side === "r" ? total(state.clips.slice(0, index + 1)) : null,
        playhead: state.t,
        timing,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      state.patch({
        trim: {
          i: index,
          side,
          shift: 0,
          lt: side === "l" ? clip.in : Math.max(clip.in, clip.out - 0.04),
        },
      });
    },
    trimMove(event: PointerEvent) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.x;
      const result =
        active.edgeTime == null
          ? { delta: dx / PPS, snapped: false }
          : snappedTimingDelta(
              active.edgeTime,
              dx / PPS,
              active.playhead,
              PPS,
              true,
            );
      if (!active.moved && Math.abs(dx) < 2 && !result.snapped) return;
      if (!active.timing.update(result.delta, true)) {
        finish(true);
        return;
      }
      active.moved = true;
      const state = useCapture.getState();
      const clip = state.clips.find((item) => item.id === active.clip.id)!;
      state.patch({
        trim: {
          i: active.index,
          side: active.side,
          shift: active.side === "l" ? (dur(active.clip) - dur(clip)) * PPS : 0,
          lt:
            active.side === "l" ? clip.in : Math.max(clip.in, clip.out - 0.04),
        },
      });
    },
    trimUp(event: PointerEvent) {
      if (gesture.current?.pointerId !== event.pointerId) return;
      finish(
        event.type === "pointercancel" || event.type === "lostpointercapture",
      );
    },
  };
}
