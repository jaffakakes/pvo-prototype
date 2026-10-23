import type { Clip } from "../project/model";

/** Clip adjustments share one immutable update boundary. */
export function adjustClip(clip: Clip, values: Partial<Clip>): Clip {
  return { ...clip, ...values };
}

/** Framing changes clear visual motion, retaining the independently authored sound. */
export function resetClipFraming(
  clip: Clip,
  fit: Clip["fit"],
  resetAppearance = false,
): Clip {
  const animation = clip.animation && {
    tracks: Object.fromEntries(
      Object.entries(clip.animation.tracks).filter(
        ([property]) =>
          property === "gain" || (!resetAppearance && property === "opacity"),
      ),
    ),
  };
  return {
    ...clip,
    fit,
    zoom: 1,
    mirror: resetAppearance ? false : clip.mirror,
    animation:
      animation && Object.keys(animation.tracks).length ? animation : undefined,
    animationTracking: undefined,
  };
}
