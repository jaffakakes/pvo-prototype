import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AnimationGroup } from "../../../domain/animation/authoring";
import type { AnimationTarget } from "../../../domain/animation/model";
import { beginAnimationGesture } from "../../../state/animation/commands";
import { useAnimationSelection } from "../../../state/animation/selection";

type Drag = {
  pointer: number;
  x: number;
  scale: number;
  group: AnimationGroup;
  time: number;
  gesture: ReturnType<typeof beginAnimationGesture>;
};

/** Pointer ownership only; snapping, neighbour bounds and Undo belong to commands. */
export function useKeyframeDrag(
  sceneId: string,
  target: AnimationTarget,
  zoom: number,
  disabled: boolean,
) {
  const drag = useRef<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => drag.current?.gesture?.cancel(), []);
  const select = (group: AnimationGroup, time: number) => {
    if (!disabled)
      useAnimationSelection.getState().select({ sceneId, target, group, time });
  };
  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    group: AnimationGroup,
    time: number,
  ) => {
    event.stopPropagation();
    if (disabled || event.button > 0) return;
    event.preventDefault();
    setError(null);
    select(group, time);
    const well = event.currentTarget.parentElement!;
    const scale = well.offsetWidth
      ? well.getBoundingClientRect().width / well.offsetWidth
      : 1;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      scale,
      group,
      time,
      gesture: null,
    };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - active.x) / active.scale;
    if (!active.gesture && Math.abs(dx) < 3) return;
    try {
      active.gesture ??= beginAnimationGesture(target);
      active.gesture?.moveKey(
        active.group,
        active.time,
        active.time + dx / zoom,
      );
    } catch (failure) {
      active.gesture?.cancel();
      drag.current = null;
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not move this keyframe.",
      );
    }
  };
  const end = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (cancelled) active.gesture?.cancel();
    else active.gesture?.commit();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { begin, move, end, select, error };
}
