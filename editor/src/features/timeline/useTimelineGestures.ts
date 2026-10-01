import { sceneDuration } from "../../domain/scenes/duration";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";
import { locate, total } from "../../domain/clips/timing";
import {
  componentLength,
  type TimingDragMode,
} from "../../domain/components/timing";
import { type LayerId } from "../../domain/layers/model";
import { layerOrder } from "../../domain/layers/order";
import type {
  Clip,
  PvoComponent,
  TextOverlay,
} from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { useCapture } from "../../state/captureStore";
import { beginComponentTimingDrag } from "../../state/components/componentTimingDrag";
import {
  finishTextTimingPreview,
  previewClipTrim,
  previewTextTiming,
} from "../../state/editing/timelineEditingCommands";
import { stopTry } from "../preview/tryMode";
import { PPS, timelineRows } from "./geometry";
import { snappedTimingDelta } from "./timingSnap";
import { usePlayheadScrub } from "./usePlayheadScrub";
import { useLayerDrag } from "./useLayerDrag";

type ComponentTimingTransaction = NonNullable<
  ReturnType<typeof beginComponentTimingDrag>
>;

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
  const trimRef = useRef<{
    x: number;
    clip: Clip;
    side: "l" | "r";
    index: number;
    moved: boolean;
    edgeTime: number | null;
    playhead: number;
  } | null>(null);
  const compDrag = useRef<{
    id: string;
    x: number;
    mode: TimingDragMode;
    timing: ComponentTimingTransaction | null;
    selected: boolean;
    moved: boolean;
    edgeTime: number | null;
    playhead: number;
  } | null>(null);
  const textDrag = useRef<{
    id: number;
    x: number;
    start: number;
    end: number;
    mode: "move" | "l" | "r";
    selected: boolean;
    moved: boolean;
    edgeTime: number | null;
    playhead: number;
  } | null>(null);
  const trimShift = s.trim?.shift ?? 0;
  const ticks = Array.from({ length: Math.ceil(length) + 5 }, (_, i) => i);
  const layout = timelineRows(layerOrder(s));
  const layers = layout.map((row) => row.id);
  const rows = new Map(layout.map((row) => [row.id, row.top]));
  const rowEnd = layout.reduce((end, row) => end + row.height, 30);
  const timelineHeight = rowEnd + s.audioClips.length * 34 + (s.sound ? 40 : 8);
  const selectedLayer: LayerId | null =
    s.selText != null
      ? `text:${s.selText}`
      : s.selComp
        ? `component:${s.selComp}`
        : s.sel >= 0
          ? "video"
          : null;
  const rowTop = (id: LayerId) =>
    layerDrag.active?.id === id ? layerDrag.active.top : rows.get(id);
  const selectLayer = (id: LayerId) =>
    id === "video"
      ? s.patch({ sel: locate(s.t, s.clips)?.i ?? 0, selComp: null, selText: null, playing: false })
      : id.startsWith("text:")
        ? s.patch({ selText: Number(id.slice(5)), sel: -1, selComp: null, playing: false })
        : s.patch({ selComp: id.slice(10), sel: -1, selText: null, playing: false });
  const layerKeyDown = (event: ReactKeyboardEvent) => {
    if (
      event.key === "Escape" &&
      (layerDrag.active || compDrag.current?.timing)
    ) {
      event.preventDefault();
      event.stopPropagation();
      layerDrag.end(true);
      compDrag.current?.timing?.cancel();
      pointer.current = null;
      compDrag.current = null;
      textDrag.current = null;
    }
    if (
      !event.altKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key) ||
      s.tryMode
    )
      return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-layer-id],[data-reorder-layer]",
    );
    const id = (target?.dataset.layerId ?? target?.dataset.reorderLayer) as
      | LayerId
      | undefined;
    if (id) {
      event.preventDefault();
      event.stopPropagation();
      s.reorderLayer(id, event.key === "ArrowUp" ? "up" : "down");
    }
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
      s.patch({ sel: Number(index), selText: null, selComp: null, playing: false });
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

  const trimDown = (
    event: ReactPointerEvent,
    index: number,
    side: "l" | "r",
  ) => {
    event.stopPropagation();
    if (event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const clip = s.clips[index];
    trimRef.current = {
      x: event.clientX,
      clip,
      side,
      index,
      moved: false,
      edgeTime:
        side === "r" ? total(s.clips.slice(0, index + 1)) : null,
      playhead: s.t,
    };
    s.patch({
      playing: false,
      trim: {
        i: index,
        side,
        shift: 0,
        lt: side === "l" ? clip.in : clip.out - 0.04,
      },
    });
  };
  const trimMove = (event: ReactPointerEvent) => {
    const d = trimRef.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const rawDelta = dx / PPS;
    const result =
      d.edgeTime == null
        ? { delta: rawDelta, snapped: false }
        : snappedTimingDelta(
            d.edgeTime,
            rawDelta,
            d.playhead,
            PPS,
            true,
          );
    if (!d.moved && Math.abs(dx) < 2 && !result.snapped) return;
    previewClipTrim(
      d.clip,
      d.index,
      d.side,
      result.delta,
      !d.moved,
      PPS,
    );
    d.moved = true;
  };
  const trimUp = () => {
    if (!trimRef.current) return;
    const shift = useCapture.getState().trim?.shift ?? 0;
    trimRef.current = null;
    const state = useCapture.getState();
    state.patch({
      trim: null,
      t: clamp(state.t - shift / PPS, 0, sceneDuration(state)),
    });
  };

  const compDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    component: PvoComponent,
  ) => {
    event.stopPropagation();
    if (event.button > 0 || s.tryMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const side = (event.target as HTMLElement).closest<HTMLElement>(
      ".compHandle",
    )?.dataset.side;
    const mode: TimingDragMode =
      side === "l" ? "start" : side === "r" ? "end" : "move";
    if (mode === "move") layerDrag.begin(`component:${component.id}`, event);
    compDrag.current = {
      id: component.id,
      x: event.clientX,
      mode,
      timing: null,
      selected: s.selComp === component.id,
      moved: false,
      edgeTime:
        mode === "start"
          ? component.at
          : mode === "end"
            ? component.at + componentLength(component, s.clips)
            : null,
      playhead: s.t,
    };
    s.patch({ selComp: component.id, sel: -1, selText: null, playing: false, orb: false });
  };
  const compMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = compDrag.current;
    if (!drag) return;
    if (drag.mode === "move") {
      const axis = layerDrag.move(event);
      if (axis !== "time") {
        if (axis === "layer") drag.moved = true;
        return;
      }
    }
    const dx = event.clientX - drag.x;
    const rawDelta = dx / PPS;
    const result =
      drag.edgeTime == null
        ? { delta: rawDelta, snapped: false }
        : snappedTimingDelta(
            drag.edgeTime,
            rawDelta,
            drag.playhead,
            PPS,
            true,
          );
    if (!drag.moved && Math.abs(dx) < 2 && !result.snapped) return;
    drag.moved = true;
    // The command owns the timing limits and the single undo step; this handler only converts pixels to seconds.
    if (!drag.timing)
      drag.timing = beginComponentTimingDrag(drag.id, drag.mode);
    drag.timing?.update(result.delta);
  };
  const compUp = (event: ReactPointerEvent) => {
    const cancelled = event.type === "pointercancel";
    layerDrag.end(cancelled);
    const drag = compDrag.current;
    compDrag.current = null;
    if (!drag) return;
    if (cancelled) drag.timing?.cancel();
    else drag.timing?.commit();
    if (drag.moved || cancelled) return;
    if (!useCapture.getState().components.some((item) => item.id === drag.id))
      return;
    // Keep the scrubbed playhead in place so "Use playhead" can move this component.
    if (drag.selected)
      s.patch({ sheet: "component", playing: false, orb: false });
  };

  const textBarDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    text: TextOverlay,
  ) => {
    event.stopPropagation();
    if (event.button > 0 || s.tryMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const side = (event.target as HTMLElement).closest<HTMLElement>(
      ".compHandle",
    )?.dataset.side;
    if (!side) layerDrag.begin(`text:${text.id}`, event);
    textDrag.current = {
      id: text.id,
      x: event.clientX,
      start: text.start,
      end: text.end,
      mode: side === "l" || side === "r" ? side : "move",
      selected: s.selText === text.id,
      moved: false,
      edgeTime: side === "l" ? text.start : side === "r" ? text.end : null,
      playhead: s.t,
    };
    s.patch({ selText: text.id, sel: -1, selComp: null, playing: false, orb: false });
  };
  const textBarMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textDrag.current;
    if (!drag) return;
    if (drag.mode === "move") {
      const axis = layerDrag.move(event);
      if (axis !== "time") {
        if (axis === "layer") drag.moved = true;
        return;
      }
    }
    const rawDelta = (event.clientX - drag.x) / PPS;
    const result =
      drag.edgeTime == null
        ? { delta: rawDelta, snapped: false }
        : snappedTimingDelta(
            drag.edgeTime,
            rawDelta,
            drag.playhead,
            PPS,
            true,
          );
    if (!drag.moved && Math.abs(rawDelta * PPS) < 3 && !result.snapped)
      return;
    previewTextTiming(
      drag.id,
      drag,
      drag.mode,
      result.delta,
      !drag.moved,
    );
    drag.moved = true;
  };
  const textBarUp = (event: ReactPointerEvent) => {
    layerDrag.end(event.type === "pointercancel");
    const drag = textDrag.current;
    textDrag.current = null;
    if (drag?.moved) finishTextTimingPreview();
    if (drag?.selected && !drag.moved && event.type !== "pointercancel")
      s.patch({ sheet: "text" });
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
    trimDown,
    trimMove,
    trimUp,
    compDown,
    compMove,
    compUp,
    textBarDown,
    textBarMove,
    textBarUp,
  };
}
