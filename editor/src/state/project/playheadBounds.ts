import type { Scene } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import type { CaptureState } from "../types";

type PlayheadState = Pick<CaptureState, "currentSceneId" | "playing" | "t">;

/** Keep the active playhead valid after a scene timing edit shortens the timeline. */
export function playheadAfterSceneTimingChange(
  state: PlayheadState,
  scene: Scene,
  preservePlayhead = false,
): Partial<Pick<CaptureState, "playing" | "t">> {
  if (preservePlayhead || scene.id !== state.currentSceneId) return {};
  const t = clamp(state.t, 0, sceneDuration(scene));
  return t === state.t ? {} : { t, playing: false };
}
