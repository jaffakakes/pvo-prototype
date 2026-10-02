import { cloneAnimation, parseAnimation } from "../../../../packages/pvo-animation/index.js";
import { parseNativeObservation, type NativeObjectTrackingObservation, type NativeTrackingTarget } from "../../../../packages/pvo-assistant/native/index.js";
import type { Scene } from "../project/model";
import type { AnimationTarget, LayerAnimation } from "./model";
import { animationSceneTime, getAnimationTarget } from "./targets";

export type TrackingStep = 0.5 | 1 | 2;
export type LayerTracking = {
  label: string;
  step: TrackingStep;
  observation: NativeObjectTrackingObservation;
  requestTarget: NativeTrackingTarget;
  sourceFingerprint: string;
  anchor: "center" | "top";
  offsetX: number;
  offsetY: number;
  /** Source/local clock identities of generated position keys; never a second animation curve. */
  generatedTimes: number[];
  /** Camera re-fitting uses the motion seen by the original inspection, avoiding feedback. */
  cameraBaseline?: LayerAnimation;
  /** The generated visibility curve lets a density refit detect later authored opacity edits. */
  visibilityAnimation?: LayerAnimation;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function parseLayerTracking(value: unknown): LayerTracking {
  const fail = () => new Error("Invalid saved object-tracking metadata.");
  if (!record(value) || Object.keys(value).some(key => !["label", "step", "observation", "requestTarget", "sourceFingerprint", "anchor", "offsetX", "offsetY", "generatedTimes", "cameraBaseline", "visibilityAnimation"].includes(key))
    || typeof value.label !== "string" || !value.label.trim() || value.label.length > 200
    || ![0.5, 1, 2].includes(value.step as number) || !["center", "top"].includes(value.anchor as string)
    || typeof value.sourceFingerprint !== "string" || !value.sourceFingerprint || value.sourceFingerprint.length > 128
    || ![value.offsetX, value.offsetY].every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 100)
    || !Array.isArray(value.generatedTimes) || !value.generatedTimes.length || value.generatedTimes.length > 120
    || value.generatedTimes.some((time, index, times) => !Number.isFinite(time) || time < 0 || time > 86400 || index > 0 && time <= times[index - 1])) throw fail();
  const target = value.requestTarget;
  if (!record(target)) throw fail();
  if (target.kind === "text") {
    if (Object.keys(target).some(key => !["kind", "text"].includes(key)) || typeof target.text !== "string" || !target.text.trim() || target.text.length > 200) throw fail();
  } else if (target.kind === "point") {
    if (Object.keys(target).some(key => !["kind", "x", "y"].includes(key))
      || ![target.x, target.y].every(item => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1)) throw fail();
  } else throw fail();
  const observation = parseNativeObservation(value.observation);
  if (observation.kind !== "object_tracking") throw fail();
  const cameraBaseline = value.cameraBaseline === undefined ? undefined : parseAnimation(value.cameraBaseline);
  const visibilityAnimation = value.visibilityAnimation === undefined ? undefined : parseAnimation(value.visibilityAnimation, ["opacity"]);
  return { ...value, requestTarget: { ...target }, observation, generatedTimes: [...value.generatedTimes],
    ...(cameraBaseline ? { cameraBaseline } : {}), ...(visibilityAnimation ? { visibilityAnimation } : {}) } as LayerTracking;
}

export function cloneLayerTracking(value: LayerTracking): LayerTracking {
  return { ...value, requestTarget: { ...value.requestTarget },
    observation: { ...value.observation, samples: value.observation.samples.map(sample => ({ ...sample })) },
    generatedTimes: [...value.generatedTimes], ...(value.cameraBaseline ? { cameraBaseline: cloneAnimation(value.cameraBaseline) } : {}),
    ...(value.visibilityAnimation ? { visibilityAnimation: cloneAnimation(value.visibilityAnimation) } : {}) };
}

export function layerTrackingData(scene: Scene, target: AnimationTarget): LayerTracking | undefined {
  if (target.kind === "clip") return scene.clips.find(item => item.id === target.id)?.animationTracking;
  if (target.kind === "text") return scene.texts.find(item => item.id === target.id)?.animationTracking;
  if (target.kind === "component") return scene.components.find(item => item.id === target.id)?.animationTracking;
}

export function getLayerTracking(scene: Scene, target: AnimationTarget) {
  const raw = layerTrackingData(scene, target);
  const info = getAnimationTarget(scene, target);
  if (!raw || !info) return null;
  const metadata = parseLayerTracking(raw);
  const generatedTimes = metadata.generatedTimes.filter(time => ["x", "y"].some(property =>
    info.animation?.tracks[property as "x" | "y"]?.some(key => Math.abs(key.time - time) < 0.000001)));
  if (!generatedTimes.length) return null;
  const times = generatedTimes.map(time => animationSceneTime(info, time))
    .filter(time => time >= info.start - 0.000001 && time <= info.end + 0.000001);
  return { ...metadata, generatedTimes, times, count: times.length };
}

export function setLayerTracking(scene: Scene, target: AnimationTarget, tracking: LayerTracking | undefined): Scene {
  const assign = <T extends { animationTracking?: LayerTracking }>(layer: T): T => {
    const { animationTracking: _previous, ...rest } = layer;
    return { ...rest, ...(tracking ? { animationTracking: cloneLayerTracking(tracking) } : {}) } as T;
  };
  if (target.kind === "clip") return { ...scene, clips: scene.clips.map(item => item.id === target.id ? assign(item) : item) };
  if (target.kind === "text") return { ...scene, texts: scene.texts.map(item => item.id === target.id ? assign(item) : item) };
  if (target.kind === "component") return { ...scene, components: scene.components.map(item => item.id === target.id ? assign(item) : item) };
  throw new Error("Only visual layers can follow an object.");
}
