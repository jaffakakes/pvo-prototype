import { componentScale, scaleComponentUniformly } from "../components/scale";
import { clamp } from "../project/numbers";
import type { Scene } from "../project/model";
import type { AnimationTarget, LayerAnimation } from "../animation/model";
import { resetClipFraming } from "../clips/adjustments";

export type OverlayTarget =
  { kind: "text"; id: number } | { kind: "component"; id: string };
export type OverlayPosition = { x: number; y: number };
export type CanvasDimensions = { width: number; height: number };
export type OverlayTransform = { x: number; y: number; size: number };

export const OVERLAY_POSITION_LIMITS = {
  x: { min: 8, max: 92 },
  y: { min: 6, max: 94 },
} as const;

/** Positions are layer-center percentages measured from the canvas's top-left corner. */
export function constrainOverlayPosition(
  value: OverlayPosition,
): OverlayPosition {
  return {
    x: clamp(
      value.x,
      OVERLAY_POSITION_LIMITS.x.min,
      OVERLAY_POSITION_LIMITS.x.max,
    ),
    y: clamp(
      value.y,
      OVERLAY_POSITION_LIMITS.y.min,
      OVERLAY_POSITION_LIMITS.y.max,
    ),
  };
}

export function overlayPositionToPixels(
  value: OverlayPosition,
  canvas: CanvasDimensions,
): OverlayPosition {
  return {
    x: (value.x / 100) * canvas.width,
    y: (value.y / 100) * canvas.height,
  };
}

export function overlayPositionFromPixels(
  value: OverlayPosition,
  canvas: CanvasDimensions,
): OverlayPosition {
  return {
    x: (value.x / canvas.width) * 100,
    y: (value.y / canvas.height) * 100,
  };
}

/** Positions use canvas percentages; size is font size or component scale. */
export function constrainOverlayTransform(
  target: OverlayTarget,
  value: OverlayTransform,
): OverlayTransform {
  const position = constrainOverlayPosition(value);
  return {
    ...position,
    size:
      target.kind === "text"
        ? clamp(value.size, 8, 64)
        : componentScale(value.size),
  };
}

function clearTransform(animation: LayerAnimation | undefined) {
  if (!animation) return undefined;
  const tracks = Object.fromEntries(
    Object.entries(animation.tracks).filter(
      ([property]) => property === "opacity" || property === "gain",
    ),
  );
  return Object.keys(tracks).length ? { tracks } : undefined;
}

/** Reset visual placement without changing the layer's content, timing or sound. */
export function resetLayerTransform(
  scene: Scene,
  target: AnimationTarget,
): Scene {
  if (target.kind === "clip")
    return {
      ...scene,
      clips: scene.clips.map((clip) =>
        clip.id === target.id ? resetClipFraming(clip, "cover", true) : clip,
      ),
    };
  if (target.kind === "component")
    return {
      ...scene,
      components: scene.components.map((item) =>
        item.id === target.id
          ? {
              ...item,
              x: 50,
              y: item.type === "tooltip" ? 28 : 60,
              ...scaleComponentUniformly(item, 1),
              rotation: 0,
              animation: clearTransform(item.animation),
              animationTracking: undefined,
            }
          : item,
      ),
    };
  if (target.kind === "text")
    return {
      ...scene,
      texts: scene.texts.map((item) =>
        item.id === target.id
          ? {
              ...item,
              x: 50,
              y: 50,
              style: item.style ? { ...item.style, rotation: 0 } : item.style,
              animation: clearTransform(item.animation),
              animationTracking: undefined,
            }
          : item,
      ),
    };
  return scene;
}
