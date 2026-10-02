import { animatedCenterVisible, evaluateAnimation, videoCoversPoint } from "../../../../packages/pvo-animation/index.js";
import { locate, total } from "../clips/timing";
import { layerZ, type LayerSource } from "../layers/order";
import type { Clip, PvoComponent } from "../project/model";

/** Visibility policy for unanswered holds. Rendering preserves the layer and its local state. */
export function componentInteractionAvailable(scene: LayerSource & { clips: Clip[] },
  component: PvoComponent, time: number, aspectRatio = 1): boolean {
  const motion = evaluateAnimation(component.animation, time - component.at);
  const center = { x: component.x ?? 50, y: component.y ?? 50 };
  if (!animatedCenterVisible(motion, center)) return false;
  if (layerZ(scene, `component:${component.id}`) > layerZ(scene, "video")) return true;
  const located = time <= total(scene.clips) ? locate(time, scene.clips) : null;
  const videoMotion = evaluateAnimation(located?.c.animation, located?.lt ?? 0);
  return !videoCoversPoint(videoMotion, { x: center.x + motion.x, y: center.y + motion.y }, aspectRatio);
}
