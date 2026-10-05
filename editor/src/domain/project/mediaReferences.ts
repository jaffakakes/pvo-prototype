import type { ProjectSnapshot } from "./model";
import { normalizeSceneTree } from "../scenes/rules";
import { remapTrackingMediaReferences } from "../animation/trackingPersistence";

/** Remap video, audio and their verified tracking references as one project operation. */
export function remapProjectMedia(
  project: ProjectSnapshot,
  urlMap: Map<string, string>,
): ProjectSnapshot {
  return remapTrackingMediaReferences(project, {
    ...project,
    scenes: normalizeSceneTree(project.scenes).map((scene) => ({
      ...scene,
      ...(scene.audioClips
        ? {
            audioClips: scene.audioClips.map((clip) => ({
              ...clip,
              url: clip.url ? (urlMap.get(clip.url) ?? null) : null,
            })),
          }
        : {}),
      clips: scene.clips.map((clip) => ({
        ...clip,
        url: clip.url ? (urlMap.get(clip.url) ?? null) : null,
      })),
    })),
  });
}
