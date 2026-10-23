import { reorderLayerKey } from "./layerKeyboard";
import {
  selectedLayerId,
  selectTimelineLayer,
} from "../../state/editing/layerSelection";
import { useTimelineTrim } from "./useTimelineTrim";
import { useTimelineLayerTiming } from "./useTimelineLayerTiming";
import { sceneDuration } from "../../domain/scenes/duration";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";
import { type LayerId } from "../../domain/layers/model";
import { layerOrder } from "../../domain/layers/order";
import { clamp } from "../../domain/project/numbers";
import { useCapture } from "../../state/captureStore";
import { stopTry } from "../preview/tryMode";
import { PPS, timelineRows, TIMELINE_HEADER_HEIGHT } from "./geometry";
import { usePlayheadScrub } from "./usePlayheadScrub";
import { useLayerDrag } from "./useLayerDrag";

export function useTimelineGestures() {
  const s = useCapture();
  const timelineRef = useRef<HTMLDivElement>(null);
  const length = sceneDuration(s);
  const playhead = usePlayheadScrub(timelineRef, length > 0);
  const layerDrag = useLayerDrag(timelineRef);
  const pointer = useRef<{
    x: number;
    start: number;
    dragged: boolean;
    clipIndex: number;
  } | null>(null);
  const ignoreClick = useRef(false);
  const trim = useTimelineTrim();
  const layerTiming = useTimelineLayerTiming(layerDrag);
  const trimShift = s.trim?.shift ?? 0;
  const ticks = Array.from({ length: Math.ceil(length) + 5 }, (_, i) => i);
  const layout = timelineRows(layerOrder(s));
  const layers = layout.map((row) => row.id);
  const rows = new Map(layout.map((row) => [row.id, row.top]));
  const rowEnd = layout.reduce(
    (end, row) => end + row.height,
    TIMELINE_HEADER_HEIGHT,
  );
  const timelineHeight = rowEnd;
  const selectedLayer = selectedLayerId(s);
  const rowTop = (id: LayerId) =>
    layerDrag.active?.id === id ? layerDrag.active.top : rows.get(id);
  const selectLayer = selectTimelineLayer;
  const layerKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && layerDrag.active) {
      event.preventDefault();
      event.stopPropagation();
      layerDrag.end(true);
      pointer.current = null;
    }
    reorderLayerKey(event);
  };

  const scrubDown = (event: ReactPointerEvent) => {
    if (s.playheadPick) {
      if (event.button > 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = {
        x: event.clientX,
        start: s.t,
        dragged: false,
        clipIndex: -1,
      };
      return;
    }
    if (s.tryMode) stopTry();
    if (
      event.button > 0 ||
      (event.target as HTMLElement).closest(
        ".mute,.addClip,.textBar,.handle,.compBar,.compMarker,.compHandle,.layerName",
      )
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = (event.target as HTMLElement).closest<HTMLElement>(".tlClip")
      ?.dataset.index;
    pointer.current = {
      x: event.clientX,
      start: s.t,
      dragged: false,
      clipIndex: index == null ? -1 : Number(index),
    };
    if (index != null) {
      layerDrag.begin("video", event);
      s.patch({
        sel: Number(index),
        selText: null,
        selComp: null,
        playing: false,
      });
    }
  };
  const scrubMove = (event: ReactPointerEvent) => {
    const d = pointer.current;
    if (!d) return;
    if (d.clipIndex >= 0 || d.clipIndex === -2) {
      const axis = layerDrag.move(event);
      if (axis !== "time") {
        if (axis === "layer") d.dragged = true;
        return;
      }
    }
    const dx = event.clientX - d.x;
    if (!d.dragged && Math.abs(dx) < 5) return;
    d.dragged = true;
    useCapture.getState().patch({
      playing: false,
      t: clamp(d.start - dx / PPS, 0, sceneDuration(useCapture.getState())),
    });
  };
  const scrubUp = (event: ReactPointerEvent) => {
    if (s.playheadPick) {
      const d = pointer.current;
      pointer.current = null;
      if (d && !d.dragged && event.type !== "pointercancel") {
        const left = timelineRef.current?.getBoundingClientRect().left ?? 0;
        s.patch({
          t: clamp(
            d.start + (event.clientX - left - playhead.x) / PPS,
            0,
            sceneDuration(s),
          ),
        });
      }
      return;
    }
    layerDrag.end(event.type === "pointercancel");
    const d = pointer.current;
    pointer.current = null;
    if (d?.dragged) {
      ignoreClick.current = true;
      window.setTimeout(() => {
        ignoreClick.current = false;
      }, 0);
    }
    if (d && !d.dragged && d.clipIndex !== -2)
      s.patch({ sel: d.clipIndex, selComp: null, selText: null, orb: false });
  };

  return {
    s,
    playhead,
    timelineRef,
    layerDrag,
    pointer,
    ignoreClick,
    length,
    trimShift,
    ticks,
    layers,
    rows,
    rowEnd,
    timelineHeight,
    selectedLayer,
    rowTop,
    selectLayer,
    layerKeyDown,
    scrubDown,
    scrubMove,
    scrubUp,
    ...trim,
    ...layerTiming,
  };
}
