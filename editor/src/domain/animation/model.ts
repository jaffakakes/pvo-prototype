import type { AnimationProperty, LayerAnimation } from "../../../../packages/pvo-animation/index.js";
export type { AnimationEasing, AnimationKeyframe, AnimationProperty, LayerAnimation } from "../../../../packages/pvo-animation/index.js";

export type AnimationTarget =
  | { kind: "clip" | "audio" | "text"; id: number }
  | { kind: "component"; id: string }
  | { kind: "music" };
export type AnimationTargetInfo = {
  animation: LayerAnimation | undefined;
  properties: readonly AnimationProperty[];
  start: number;
  end: number;
  /** Local/source time = offset + (scene time - origin) * rate. */
  clock: { origin: number; offset: number; rate: number };
};
