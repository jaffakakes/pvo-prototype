import { cloneAnimation, evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import type { NativeObjectTrackingObservation, NativeTrackingTarget, NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import type { ProjectSnapshot } from "../project/model";
import { authoringBasePosition } from "./authoring";
import { followObjectTracking, type TrackingAttachment } from "./tracking";
import { fitTrackingDensity } from "./trackingDensity";
import { nativeTrackingFingerprint } from "./trackingEvidence";
import { getLayerTracking, setLayerTracking, type LayerTracking, type TrackingStep } from "./trackingMetadata";
import { animationTime, getAnimationTarget } from "./targets";

/** Add readable generated keys and durable authoring provenance to one private candidate scene. */
export function createTrackedAnimation(project: ProjectSnapshot, target: NativeVisualAnimationTarget,
  observation: NativeObjectTrackingObservation, attachment: TrackingAttachment,
  requestTarget: NativeTrackingTarget, step: TrackingStep = 1, previous?: LayerTracking) {
  const scene = project.scenes.find(item => item.id === observation.sceneId);
  const info = scene && getAnimationTarget(scene, target);
  if (!scene || !info) throw new Error("The tracked layer no longer exists.");
  const first = observation.samples.find(sample => sample.visible && sample.score >= 0.25);
  if (!first) throw new Error("The requested object was not tracked confidently.");
  const initial = evaluateAnimation(info.animation, animationTime(info, observation.start));
  const base = authoringBasePosition(scene, target);
  const placement = previous ? { anchor: previous.anchor, offsetX: previous.offsetX, offsetY: previous.offsetY }
    : target.kind === "clip" ? attachment : { ...attachment,
      offsetX: base.x + initial.x - first.x * 100 + attachment.offsetX,
      offsetY: base.y + initial.y - (first.y - (attachment.anchor === "top" ? first.height / 2 : 0)) * 100 + attachment.offsetY };
  const cameraBaseline = previous?.cameraBaseline ?? (target.kind === "clip" ? cloneAnimation(info.animation) ?? { tracks: {} } : undefined);
  const fitted = fitTrackingDensity(observation, step);
  const allowGeneratedOpacity = !!previous?.visibilityAnimation
    && JSON.stringify(info.animation?.tracks.opacity) === JSON.stringify(previous.visibilityAnimation.tracks.opacity);
  let next = followObjectTracking(scene, target, fitted, placement, { simplify: false, cameraBaseline, allowGeneratedOpacity });
  const opacity = getAnimationTarget(next, target)?.animation?.tracks.opacity;
  const visibilityAnimation = target.kind !== "clip" && opacity && observation.samples.some(sample => !sample.visible || sample.score < .25)
    ? { tracks: { opacity } } : undefined;
  const sourceFingerprint = nativeTrackingFingerprint({ ...project, scenes: project.scenes.map(item => item.id === scene.id ? next : item) }, scene.id, observation.clipId);
  next = setLayerTracking(next, target, { label: requestTarget.kind === "text" ? requestTarget.text : "Selected object", step,
    requestTarget, observation, sourceFingerprint, ...placement,
    generatedTimes: fitted.samples.map(sample => animationTime(info, sample.time)), ...(cameraBaseline ? { cameraBaseline } : {}),
    ...(visibilityAnimation ? { visibilityAnimation } : {}) });
  return next;
}

export function refitTrackedAnimation(project: ProjectSnapshot, target: NativeVisualAnimationTarget, step: TrackingStep) {
  const scene = project.scenes.find(item => item.id === project.currentSceneId);
  const tracking = scene && getLayerTracking(scene, target);
  if (!scene || !tracking) throw new Error("This layer has no generated object track.");
  if (tracking.sourceFingerprint !== nativeTrackingFingerprint(project, scene.id, tracking.observation.clipId))
    throw new Error("The video changed after tracking. Re-track the object before changing its density.");
  return createTrackedAnimation(project, target, tracking.observation, tracking, tracking.requestTarget, step, tracking);
}
