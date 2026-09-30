import { useId, useRef, useState } from "react";
import {
  OVERLAY_POSITION_LIMITS,
  overlayPositionToPixels,
  type OverlayPosition,
  type OverlayTarget,
} from "../../domain/layers/transform";
import { projectCanvasSize } from "../../domain/project/ratio";
import { useCapture } from "../../state/captureStore";
import { setOverlayPixelPosition } from "../../state/editing/overlayPosition";
import styles from "./LayerPositionControls.module.css";

type Axis = keyof OverlayPosition;

function PositionField({ axis, value, min, max, descriptionId, onCommit }: {
  axis: Axis;
  value: number;
  min: number;
  max: number;
  descriptionId: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const label = axis.toUpperCase();
  return <label className={styles.field}>
    <span>{label} <span className={styles.unit}>(px)</span></span>
    <input
      type="number"
      inputMode="numeric"
      aria-label={`${label} position (px)`}
      aria-describedby={descriptionId}
      min={min}
      max={max}
      step="1"
      value={draft ?? Math.round(value)}
      onFocus={() => { cancelled.current = false; }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft !== null && draft.trim() && Number.isFinite(Number(draft))) {
          onCommit(Number(draft));
        }
        setDraft(null);
      }}
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = event.key === "Escape";
        event.currentTarget.blur();
      }}
    />
  </label>;
}

export function LayerPositionControls({ target, x, y }: {
  target: OverlayTarget;
  x: number;
  y: number;
}) {
  const descriptionId = useId();
  const ratio = useCapture(state => state.ratio);
  const canvas = projectCanvasSize(ratio);
  const pixels = overlayPositionToPixels({ x, y }, canvas);
  const bounds = {
    x: {
      min: Math.ceil(canvas.width * OVERLAY_POSITION_LIMITS.x.min / 100),
      max: Math.floor(canvas.width * OVERLAY_POSITION_LIMITS.x.max / 100),
    },
    y: {
      min: Math.ceil(canvas.height * OVERLAY_POSITION_LIMITS.y.min / 100),
      max: Math.floor(canvas.height * OVERLAY_POSITION_LIMITS.y.max / 100),
    },
  };
  const commit = (axis: Axis, value: number) => setOverlayPixelPosition(target, { [axis]: value });
  return <div className={styles.controls} data-layer-position-controls>
    <h3>Position</h3>
    <div className={styles.fields}>
      <PositionField axis="x" value={pixels.x} min={bounds.x.min} max={bounds.x.max}
        descriptionId={descriptionId} onCommit={value => commit("x", value)} />
      <PositionField axis="y" value={pixels.y} min={bounds.y.min} max={bounds.y.max}
        descriptionId={descriptionId} onCommit={value => commit("y", value)} />
    </div>
    <p id={descriptionId}>Layer centre in pixels from the top-left of the {canvas.width} × {canvas.height} canvas.</p>
  </div>;
}
