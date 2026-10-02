import type { Scene } from "../project/model";
import { clearDeletedComponentRoutes } from "./references";
import { sceneSubtreeIds } from "./rules";

/** Removing a branch also clears every surviving Fields/PVO route into that branch. */
export function removeSceneSubtree(scenes: Scene[], id: string) {
  const deleted = sceneSubtreeIds(scenes, id);
  const remaining = scenes.filter(scene => !deleted.has(scene.id)).map(scene => ({
    ...scene, components: scene.components.map(component => clearDeletedComponentRoutes(component, deleted)),
  }));
  return { scenes: remaining, deleted, parent: scenes.find(scene => scene.id === id)?.parent ?? "main" };
}
