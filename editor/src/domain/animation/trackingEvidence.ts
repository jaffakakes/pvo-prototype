import type { NativeObjectTrackingObservation, NativeTrackingTarget } from "../../../../packages/pvo-assistant/native/index.js";
import { total } from "../clips/timing";
import type { ProjectSnapshot } from "../project/model";
import { nativeValueFingerprint } from "../assistant/native/context";

export type NativeTrackingEvidence = { observation: NativeObjectTrackingObservation; fingerprint: string; requestTarget: NativeTrackingTarget };

/** Only video pixels, canvas geometry and source timing invalidate a completed object track. */
export function nativeTrackingFingerprint(project: ProjectSnapshot, sceneId: string, clipId: number): string {
  const scene = project.scenes.find(scene => scene.id === sceneId);
  const index = scene?.clips.findIndex(clip => clip.id === clipId) ?? -1;
  if (!scene || index < 0) throw new Error("The tracked source clip no longer exists.");
  const { animation, animationTracking: _animationTracking, audioDetached: _audioDetached, ...clip } = scene.clips[index];
  const { gain: _gain, ...tracks } = animation?.tracks ?? {};
  return nativeValueFingerprint({ ratio: project.ratio, sceneId, start: total(scene.clips.slice(0, index)),
    clip, animation: { tracks } });
}
