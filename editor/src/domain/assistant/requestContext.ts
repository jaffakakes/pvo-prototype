import { ASSISTANT_MAX_SCENES, type AssistantContext } from "../../../../packages/pvo-assistant/index.js";

type SceneContext = { id: string; name: string; clips: readonly unknown[] };

/** Send only bounded scene labels needed for playback edits, never footage or project data. */
export function assistantRequestContext(
  currentSceneId: string, duration: number, scenes: readonly SceneContext[],
): AssistantContext | undefined {
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  const playable = scenes.filter(scene => scene.clips.length && scene.id.length <= 128
    && scene.id.trim() === scene.id && scene.id.length > 0);
  const current = playable.find(scene => scene.id === currentSceneId);
  if (!current) return undefined;
  const bounded = [current, ...playable.filter(scene => scene.id !== currentSceneId)].slice(0, ASSISTANT_MAX_SCENES);
  return { currentSceneId, duration, scenes: bounded.map(scene => ({
    id: scene.id, name: scene.name.trim().slice(0, 120) || "Scene",
  })) };
}
