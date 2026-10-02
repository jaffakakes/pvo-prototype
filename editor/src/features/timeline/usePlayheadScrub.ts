import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { sceneDuration } from "../../domain/scenes/duration";
import { clamp } from "../../domain/project/numbers";
import { useCapture } from "../../state/captureStore";
import { scrubPlayback } from "../../state/editing/playbackCommands";
import { PLAYHEAD_X, PPS } from "./geometry";

type Drag = {
  pointerId: number;
  clientX: number;
  time: number;
  x: number;
  sceneId: string;
  element: HTMLButtonElement;
};

/** Move the playhead within the viewport, keeping the visible clips still while seeking. */
export function usePlayheadScrub(timeline: RefObject<HTMLDivElement>, available: boolean) {
  const sceneId = useCapture(state => state.currentSceneId);
  const [position, setPosition] = useState({ sceneId, x: PLAYHEAD_X });
  const x = position.sceneId === sceneId ? position.x : PLAYHEAD_X;
  const drag = useRef<Drag | null>(null);
  const maximumX = () => Math.max(PLAYHEAD_X, (timeline.current?.clientWidth ?? 0) - 22);
  const moveTo = (time: number, startTime: number, startX: number) => {
    const state = useCapture.getState();
    const nextTime = clamp(time, 0, sceneDuration(state));
    setPosition({
      sceneId: state.currentSceneId,
      x: clamp(startX + (nextTime - startTime) * PPS, PLAYHEAD_X, maximumX()),
    });
    scrubPlayback(nextTime);
  };
  const finish = (cancelled: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (cancelled && useCapture.getState().currentSceneId === current.sceneId) {
      setPosition({ sceneId: current.sceneId, x: clamp(current.x, PLAYHEAD_X, maximumX()) });
      scrubPlayback(current.time);
    }
    if (current.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
  };
  useLayoutEffect(() => {
    const element = timeline.current;
    if (!available || !element) return;
    let width = element.clientWidth;
    const resize = () => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      finish(true);
      setPosition(previous => ({
        sceneId,
        x: clamp(previous.sceneId === sceneId ? previous.x : PLAYHEAD_X, PLAYHEAD_X, maximumX()),
      }));
    };
    const cancel = () => finish(true);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("blur", cancel);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [sceneId, timeline, available]);

  return {
    x,
    handleProps: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        event.stopPropagation();
        const state = useCapture.getState();
        if (event.button !== 0 || !event.isPrimary || state.tryMode || drag.current) return;
        event.preventDefault();
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          time: state.t,
          x,
          sceneId: state.currentSceneId,
          element: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubPlayback(state.t);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        event.stopPropagation();
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        moveTo(current.time + (event.clientX - current.clientX) / PPS, current.time, current.x);
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        event.stopPropagation();
        if (drag.current?.pointerId === event.pointerId) finish(false);
      },
      onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
        event.stopPropagation();
        if (drag.current?.pointerId === event.pointerId) finish(true);
      },
      onLostPointerCapture() { finish(true); },
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const state = useCapture.getState();
        if (state.tryMode) return;
        const step = event.shiftKey ? 1 : 0.1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? sceneDuration(state)
          : state.t + (event.key === "ArrowLeft" ? -step : step);
        moveTo(next, state.t, x);
      },
    },
  };
}
