import type { OverlayTransform } from "../../domain/layers/transform";
import { gestureGeometry, type GesturePoint } from "./gestureGeometry";

type CanvasTransform = OverlayTransform & { rotation: number };
export type TransformGeometry = {
  x: number;
  y: number;
  distance: number;
  angle: number;
};
export type TransformBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function contactGeometry(points: GesturePoint[]): TransformGeometry {
  const [first, second] = points;
  return {
    ...gestureGeometry(points),
    angle: second ? Math.atan2(second.y - first.y, second.x - first.x) : 0,
  };
}

export function wrapRotation(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Keep the picture under the fingers fixed as their midpoint, angle and distance change. */
export function gestureTransform(
  original: CanvasTransform,
  anchor: TransformGeometry,
  next: TransformGeometry,
  bounds: TransformBounds,
  limits: readonly [number, number] = [0.5, 2],
): CanvasTransform {
  const size = Math.max(
    limits[0],
    Math.min(limits[1], (original.size * next.distance) / anchor.distance),
  );
  const ratio = size / original.size;
  const turn = wrapRotation(((next.angle - anchor.angle) * 180) / Math.PI);
  const radians = (turn * Math.PI) / 180;
  const x = bounds.left + (original.x / 100) * bounds.width - anchor.x;
  const y = bounds.top + (original.y / 100) * bounds.height - anchor.y;
  return {
    x:
      ((next.x +
        ratio * (x * Math.cos(radians) - y * Math.sin(radians)) -
        bounds.left) /
        bounds.width) *
      100,
    y:
      ((next.y +
        ratio * (x * Math.sin(radians) + y * Math.cos(radians)) -
        bounds.top) /
        bounds.height) *
      100,
    size,
    rotation: wrapRotation(original.rotation + turn),
  };
}
