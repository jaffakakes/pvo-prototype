import { evaluateAnimation } from "../../../../../packages/pvo-animation/index.js";
import type { AnimationTarget } from "../../../domain/animation/model";
import type { ProjectSnapshot } from "../../../domain/project/model";
import { nativeTrackingFingerprint } from "../../../domain/animation/trackingEvidence";
import { getLayerTracking } from "../../../domain/animation/trackingMetadata";
import { animationTime, getAnimationTarget } from "../../../domain/animation/targets";

/** Display measured evidence only; never interpolate a box through a lost target. */
export function trackedStageBox(project: ProjectSnapshot, sceneId: string, target: AnimationTarget, time: number) {
  const scene = project.scenes.find(item => item.id === sceneId);
  const tracking = scene && getLayerTracking(scene, target);
  if (!scene || !tracking || time < tracking.observation.start || time > tracking.observation.end) return null;
  try {
    if (tracking.sourceFingerprint !== nativeTrackingFingerprint(project, sceneId, tracking.observation.clipId)) return null;
  } catch { return null; }
  const sample = tracking.observation.samples.reduce((nearest, item) =>
    Math.abs(item.time - time) < Math.abs(nearest.time - time) ? item : nearest);
  if (!sample.visible || sample.score < .25) return null;
  let x = sample.x, y = sample.y;
  if (target.kind === "clip") {
    const info = getAnimationTarget(scene, target);
    if (!info || !tracking.cameraBaseline || target.id !== tracking.observation.clipId) return null;
    const local = animationTime(info, sample.time);
    const baseline = evaluateAnimation(tracking.cameraBaseline, local);
    const current = evaluateAnimation(info.animation, local);
    // Camera following changes translation. A changed crop/rotation/scale cannot
    // be recovered from an axis-aligned measured box, so don't invent one.
    if (current.scaleX !== baseline.scaleX || current.scaleY !== baseline.scaleY || current.rotation !== baseline.rotation) return null;
    x += (current.x - baseline.x) / 100;
    y += (current.y - baseline.y) / 100;
  }
  return { x, y, width: sample.width, height: sample.height, label: tracking.label, time: sample.time };
}
