import type { Scene } from "../project/model";
import type { AnimationTarget } from "./model";
import { getAuthoringGroups, getAuthoringKeys } from "./authoring";
import { KEYFRAME_TIME_EPSILON } from "./editing";

/** One diamond represents a visual transform, or a volume key in audio mode. */
export function timelineAnimationKeys(
  scene: Scene,
  target: AnimationTarget,
  audio = false,
) {
  const groups = getAuthoringGroups(target).filter((group) =>
    audio ? group === "volume" : group !== "volume",
  );
  const keys = groups.flatMap((group) =>
    getAuthoringKeys(scene, target, group).map((key) => ({ ...key, group })),
  );
  const unique: typeof keys = [];
  for (const key of keys.sort((left, right) => left.time - right.time)) {
    if (
      !unique.length ||
      Math.abs(unique.at(-1)!.time - key.time) >= KEYFRAME_TIME_EPSILON
    )
      unique.push(key);
  }
  return unique;
}

/** Easing belongs to the segment's starting key, including when scrubbing between keys. */
export function timelineAnimationSegment(
  keys: ReturnType<typeof timelineAnimationKeys>,
  time: number,
) {
  let index = keys.length - 1;
  while (index >= 0 && keys[index].time > time + KEYFRAME_TIME_EPSILON) index--;
  return index < 0 ? null : { key: keys[index], next: keys[index + 1] ?? null };
}
