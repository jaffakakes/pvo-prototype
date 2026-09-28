import { componentScale } from "../components/scale";
import { clamp } from "../project/numbers";

export type OverlayTarget = { kind: "text"; id: number } | { kind: "component"; id: string };
export type OverlayTransform = { x: number; y: number; size: number };

/** Positions use canvas percentages; size is font size or component scale. */
export function constrainOverlayTransform(target: OverlayTarget, value: OverlayTransform): OverlayTransform {
  return {
    x: clamp(value.x, 8, 92),
    y: clamp(value.y, 6, 94),
    size: target.kind === "text" ? clamp(value.size, 8, 64) : componentScale(value.size),
  };
}
