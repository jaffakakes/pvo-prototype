import type { AnimationKeyframe, LayerAnimation } from "../animation/model";

export type TextEffect =
  "none" | "fadeIn" | "fadeOut" | "slideRight" | "pop" | "jitter" | "flicker";

/** Text effects use the same layer-local animation tracks as playback and export. */
export function textEffectAnimation(
  effect: TextEffect,
  duration: number,
): LayerAnimation | undefined {
  if (effect === "none") return undefined;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("A text effect needs a positive duration.");
  const span = Math.min(0.6, duration);
  const keys = (
    values: number[],
    easing: AnimationKeyframe["easing"] = "ease-out",
  ) =>
    values.map((value, index) => ({
      time: (span * index) / (values.length - 1),
      value,
      easing,
    }));
  switch (effect) {
    case "fadeIn":
      return { tracks: { opacity: keys([0, 1]) } };
    case "fadeOut":
      return {
        tracks: {
          opacity: [
            { time: duration - span, value: 1, easing: "ease-in" },
            { time: duration, value: 0, easing: "linear" },
          ],
        },
      };
    case "slideRight":
      return { tracks: { x: keys([-18, 0]), opacity: keys([0, 1]) } };
    case "pop":
      return {
        tracks: { scaleX: keys([0.5, 1.12, 1]), scaleY: keys([0.5, 1.12, 1]) },
      };
    case "jitter":
      return {
        tracks: {
          x: keys([0, 1.5, -1.5, 1, -1, 0], "linear"),
          y: keys([0, -0.8, 0.8, -0.4, 0.4, 0], "linear"),
        },
      };
    case "flicker":
      return { tracks: { opacity: keys([1, 0, 1, 0, 1], "hold") } };
  }
}

export function matchingTextEffect(
  animation: LayerAnimation | undefined,
  duration: number,
): TextEffect | null {
  if (!animation || !Object.keys(animation.tracks).length) return "none";
  for (const effect of [
    "fadeIn",
    "fadeOut",
    "slideRight",
    "pop",
    "jitter",
    "flicker",
  ] as const) {
    if (
      JSON.stringify(animation) ===
      JSON.stringify(textEffectAnimation(effect, duration))
    )
      return effect;
  }
  return null;
}
