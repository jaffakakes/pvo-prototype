import type { CSSProperties } from "react";
import type { SceneLayer } from "../../domain/layers/sceneLayers";
import { useCapture } from "../../state/captureStore";
import {
  selectedLayerId,
  selectTimelineLayer,
} from "../../state/editing/layerSelection";
import { useLayerPointer } from "../timeline/useLayerPointer";
import type { useLayerDrag } from "../timeline/useLayerDrag";
import type { TimingSnapSettings } from "../timeline/timingSnap";
import { TimelineKeyframes } from "../animation/TimelineKeyframes";
import styles from "./AudioClipBar.module.css";

type AudioLayer = Extract<SceneLayer, { type: "audio" | "music" }>;
export function TimelineAudioBar({
  layer,
  pixelsPerSecond,
  snap,
  style,
  layerDrag,
}: {
  layer: AudioLayer;
  pixelsPerSecond: number;
  snap?: TimingSnapSettings;
  style?: CSSProperties;
  layerDrag?: ReturnType<typeof useLayerDrag>;
}) {
  const selected = useCapture((state) => selectedLayerId(state) === layer.id);
  const blocked = useCapture(
    (state) => !!state.tryMode || !!state.playheadPick,
  );
  const pointer = useLayerPointer(layerDrag, pixelsPerSecond, snap);
  const offset = layer.type === "audio" ? layer.value.in : layer.value.offset;
  const sourceEnd =
    layer.type === "audio"
      ? layer.value.out
      : layer.value.offset + layer.value.duration;
  return (
    <button
      type="button"
      className={styles.clip}
      data-layer-id={layer.id}
      data-layer-type={layer.type}
      data-audio-id={layer.type === "audio" ? layer.value.id : undefined}
      data-selected={selected}
      aria-label={`${layer.label}, ${(layer.end - layer.start).toFixed(1)} seconds`}
      disabled={blocked}
      style={{
        left: layer.start * pixelsPerSecond,
        width: (layer.end - layer.start) * pixelsPerSecond,
        ...style,
      }}
      onPointerDown={(event) => {
        const edge = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-edge]",
        )?.dataset.edge;
        const mode = edge === "l" || edge === "r" ? edge : "move";
        pointer.begin(
          event,
          layer.id,
          mode,
          mode === "l" ? layer.start : mode === "r" ? layer.end : null,
        );
      }}
      onPointerMove={pointer.move}
      onPointerUp={pointer.end}
      onPointerCancel={pointer.end}
      onLostPointerCapture={pointer.end}
      onClick={(event) => {
        event.stopPropagation();
        if (!blocked) selectTimelineLayer(layer.id);
      }}
    >
      {selected && <span className={styles.handle} data-edge="l" />}
      <span className={styles.name}>
        ♪ {layer.label}
        {layer.type === "audio" && layer.value.muted ? " · muted" : ""}
      </span>
      {selected && <span className={styles.handle} data-edge="r" />}
      <TimelineKeyframes
        animation={layer.value.animation}
        color="#5CF0C0"
        start={offset}
        end={sourceEnd}
      />
    </button>
  );
}
