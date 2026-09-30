import { componentScale } from "../components/scale";
import { clamp } from "../project/numbers";

export type OverlayTarget = { kind: "text"; id: number } | { kind: "component"; id: string };
export type OverlayPosition = { x: number; y: number };
export type CanvasDimensions = { width: number; height: number };
export type OverlayTransform = { x: number; y: number; size: number };

export const OVERLAY_POSITION_LIMITS = {
  x: { min: 8, max: 92 },
  y: { min: 6, max: 94 },
} as const;

/** Positions are layer-center percentages measured from the canvas's top-left corner. */
export function constrainOverlayPosition(value: OverlayPosition): OverlayPosition {
  return {
    x: clamp(value.x, OVERLAY_POSITION_LIMITS.x.min, OVERLAY_POSITION_LIMITS.x.max),
    y: clamp(value.y, OVERLAY_POSITION_LIMITS.y.min, OVERLAY_POSITION_LIMITS.y.max),
  };
}

export function overlayPositionToPixels(value: OverlayPosition, canvas: CanvasDimensions): OverlayPosition {
  return {
    x: value.x / 100 * canvas.width,
    y: value.y / 100 * canvas.height,
  };
}

export function overlayPositionFromPixels(value: OverlayPosition, canvas: CanvasDimensions): OverlayPosition {
  return {
    x: value.x / canvas.width * 100,
    y: value.y / canvas.height * 100,
  };
}

/** Positions use canvas percentages; size is font size or component scale. */
export function constrainOverlayTransform(target: OverlayTarget, value: OverlayTransform): OverlayTransform {
  const position = constrainOverlayPosition(value);
  return {
    ...position,
    size: target.kind === "text" ? clamp(value.size, 8, 64) : componentScale(value.size),
  };
}
