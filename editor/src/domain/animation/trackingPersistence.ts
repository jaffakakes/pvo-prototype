import type { NativeVisualAnimationTarget } from "../../../../packages/pvo-assistant/native/index.js";
import type { ProjectSnapshot } from "../project/model";
import { nativeTrackingFingerprint } from "./trackingEvidence";
import { layerTrackingData, setLayerTracking } from "./trackingMetadata";

/** A verified URL↔asset-ID remap changes addresses, not media. Preserve only already-fresh evidence. */
export function remapTrackingMediaReferences(before: ProjectSnapshot, after: ProjectSnapshot): ProjectSnapshot {
  return { ...after, scenes: after.scenes.map(scene => {
    let next = scene;
    const targets: NativeVisualAnimationTarget[] = [
      ...scene.clips.map(item => ({ kind: "clip" as const, id: item.id })),
      ...scene.texts.map(item => ({ kind: "text" as const, id: item.id })),
      ...scene.components.map(item => ({ kind: "component" as const, id: item.id })),
    ];
    for (const target of targets) {
      const tracking = layerTrackingData(scene, target);
      if (!tracking) continue;
      const sourceScene = before.scenes.find(item => item.id === tracking.observation.sceneId);
      const source = sourceScene?.clips.find(item => item.id === tracking.observation.clipId);
      const remappedSource = after.scenes.find(item => item.id === sourceScene?.id)?.clips.find(item => item.id === source?.id);
      if (!source?.url || !remappedSource?.url) continue;
      if (tracking.sourceFingerprint !== nativeTrackingFingerprint(before, tracking.observation.sceneId, source.id)) continue;
      next = setLayerTracking(next, target, { ...tracking,
        sourceFingerprint: nativeTrackingFingerprint(after, tracking.observation.sceneId, source.id) });
    }
    return next;
  }) };
}
