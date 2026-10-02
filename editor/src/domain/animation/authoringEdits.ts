import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import type { Scene } from "../project/model";
import { animatedAuthoringGroups, AUTHORING_PROPERTIES, authoringBasePosition, getAuthoringGroups, getAuthoringKeys,
  snapAuthoringTime, type AnimationGroup, type AuthoringOptions, type AuthoringValue } from "./authoring";
import { changeLayerAnimation, KEYFRAME_TIME_EPSILON } from "./editing";
import type { AnimationEasing, AnimationProperty, AnimationTarget } from "./model";
import { animationTime, getAnimationTarget } from "./targets";
import { layerTrackingData, setLayerTracking } from "./trackingMetadata";

export type AuthoringChange =
  | { kind: "add" | "remove"; time: number; options?: AuthoringOptions }
  | { kind: "value"; group: AnimationGroup; time: number; value: AuthoringValue; options?: AuthoringOptions }
  | { kind: "easing"; group: AnimationGroup; time: number; easing: AnimationEasing; options?: AuthoringOptions }
  | { kind: "move"; group: AnimationGroup; from: number; to: number; options?: AuthoringOptions };
export type AuthoringEdit = { scene: Scene; time: number; group: AnimationGroup };
const close = (left: number, right: number) => Math.abs(left - right) < KEYFRAME_TIME_EPSILON;

function groupsFor(scene: Scene, target: AnimationTarget, group?: AnimationGroup, whole = false): AnimationGroup[] {
  const allowed = getAuthoringGroups(target);
  if (group && !allowed.includes(group)) throw new Error("This layer does not support that animation property.");
  if (group === "volume") return ["volume"];
  if (whole) return allowed.filter(item => item !== "volume" || allowed.length === 1);
  if (group) return [group];
  const animated = animatedAuthoringGroups(scene, target);
  return animated.length ? animated : [allowed[0]];
}

function valuesFor(scene: Scene, target: AnimationTarget, group: AnimationGroup, value: AuthoringValue): Partial<Record<AnimationProperty, number>> {
  const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));
  if (group === "position") {
    if (typeof value === "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error("Position needs finite X and Y values.");
    const base = authoringBasePosition(scene, target);
    return { x: clamp(value.x, 8, 92) - base.x, y: clamp(value.y, 6, 94) - base.y };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Choose a finite animation value.");
  if (group === "scale") return { scaleX: clamp(value, 0.5, 2), scaleY: clamp(value, 0.5, 2) };
  if (group === "rotation") return { rotation: clamp(value, -180, 180) };
  return { [group === "opacity" ? "opacity" : "gain"]: clamp(value, 0, 100) / 100 };
}

function resolvedTime(scene: Scene, target: AnimationTarget, groups: AnimationGroup[], requested: number): number {
  const info = getAnimationTarget(scene, target)!;
  if (!Number.isFinite(requested) || requested < info.start - KEYFRAME_TIME_EPSILON || requested > info.end + KEYFRAME_TIME_EPSILON)
    throw new Error("Keyframe time must be inside the selected layer.");
  const keys = groups.flatMap(group => getAuthoringKeys(scene, target, group));
  const existing = keys.find(key => close(key.time, requested));
  return existing?.time ?? snapAuthoringTime(requested, info.start, info.end);
}

/** Grouped authoring writes one candidate scene while retaining source clocks and unrelated curves. */
export function changeAuthoringAnimation(scene: Scene, target: AnimationTarget, change: AuthoringChange): AuthoringEdit {
  const info = getAnimationTarget(scene, target);
  if (!info) throw new Error("The animation layer no longer exists.");
  const group = "group" in change ? change.group : change.options?.group;
  const groups = groupsFor(scene, target, group, change.options?.wholeTransform);
  const requested = change.kind === "move" ? change.from : change.time;
  let time = resolvedTime(scene, target, groups, requested);
  let next = scene;
  if (change.kind === "move") {
    if (!Number.isFinite(change.to)) throw new Error("Choose a valid keyframe time.");
    const times = [...new Set(groups.flatMap(item => getAuthoringKeys(scene, target, item).map(key => key.time)))].sort((a, b) => a - b);
    const index = times.findIndex(item => close(item, time));
    if (index < 0) throw new Error("The keyframe no longer exists.");
    const minimum = index ? times[index - 1] + 0.1 : info.start;
    const maximum = index + 1 < times.length ? times[index + 1] - 0.1 : info.end;
    const gridMinimum = info.start + Math.ceil((minimum - info.start - KEYFRAME_TIME_EPSILON) * 20) / 20;
    const gridMaximum = close(maximum, info.end) ? info.end
      : info.start + Math.floor((maximum - info.start + KEYFRAME_TIME_EPSILON) * 20) / 20;
    if (gridMinimum > gridMaximum + KEYFRAME_TIME_EPSILON) return { scene, time, group: group ?? groups[0] };
    const to = Math.max(gridMinimum, Math.min(gridMaximum, snapAuthoringTime(change.to, info.start, info.end)));
    for (const property of groups.flatMap(item => AUTHORING_PROPERTIES[item])) {
      if (info.animation?.tracks[property]?.some(key => close(key.time, animationTime(info, time))))
        next = changeLayerAnimation(next, target, { kind: "move", property, from: time, to });
    }
    const tracking = layerTrackingData(scene, target);
    if (tracking && groups.includes("position")) next = setLayerTracking(next, target, { ...tracking,
      generatedTimes: tracking.generatedTimes.map(value => close(value, animationTime(info, time)) ? animationTime(info, to) : value).sort((a, b) => a - b) });
    return { scene: next, time: to, group: group ?? groups[0] };
  }
  const canonicalTime = animationTime(info, time);
  const current = evaluateAnimation(info.animation, canonicalTime);
  const values = change.kind === "value" ? valuesFor(scene, target, change.group, change.value) : {};
  for (const item of groups) {
    for (const property of AUTHORING_PROPERTIES[item]) {
      const existing = info.animation?.tracks[property]?.find(key => close(key.time, canonicalTime));
      if (change.kind === "remove") next = changeLayerAnimation(next, target, { kind: "remove", property, time });
      else if (change.kind === "easing") {
        if (existing) next = changeLayerAnimation(next, target, { kind: "set", property, time, value: existing.value, easing: change.easing });
      } else if (!existing || change.kind === "value") {
        next = changeLayerAnimation(next, target, { kind: "set", property, time,
          value: values[property] ?? current[property], easing: existing?.easing ?? "linear" });
      }
    }
  }
  return { scene: next, time, group: group ?? groups[0] };
}

/** Deterministic fade generators preserve all existing keys outside their authored interval. */
export function changeAuthoringFade(scene: Scene, target: AnimationTarget, direction: "in" | "out"): Scene {
  const info = getAnimationTarget(scene, target);
  if (!info?.properties.includes("gain")) throw new Error("This layer does not have volume animation.");
  const start = direction === "in" ? info.start : Math.max(info.start, info.end - 1);
  const end = direction === "in" ? Math.min(info.end, info.start + 0.8) : info.end;
  if (end <= start) return scene;
  let next = scene;
  for (const key of getAuthoringKeys(scene, target, "volume")) if (key.time >= start && key.time <= end)
    next = changeLayerAnimation(next, target, { kind: "remove", property: "gain", time: key.time });
  next = changeLayerAnimation(next, target, { kind: "set", property: "gain", time: start,
    value: direction === "in" ? 0 : 1, easing: direction === "in" ? "ease-out" : "ease-in" });
  return changeLayerAnimation(next, target, { kind: "set", property: "gain", time: end,
    value: direction === "in" ? 1 : 0, easing: "linear" });
}
