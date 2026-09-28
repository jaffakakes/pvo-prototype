import type { Scene } from "../../domain/project/model";
import { duplicateSceneData } from "../../domain/scenes/duplicate";
import { clearDeletedComponentRoutes } from "../../domain/scenes/references";
import { canReparentScene, nextSceneName, sceneChildren, sceneSubtreeIds } from "../../domain/scenes/rules";
import { uid } from "../../infrastructure/ids";
import type { CaptureState } from "../types";

function sceneSelection(id: string): Partial<CaptureState> {
  return {
    currentSceneId: id, screen: "editor", recordingInto: null, t: 0,
    sel: -1, selComp: null, selText: null, playing: false, trim: null, orb: false,
    tryMode: null, sheet: null, playheadPick: null, ratioMenu: false,
  };
}

export function createSceneActions(get: () => CaptureState): Pick<CaptureState, "switchScene" | "createScene" | "duplicateScene" | "deleteScene" | "startRecordingIntoScene" | "cancelRecordingIntoScene" | "updateScene"> {
  return {
    switchScene: (id, options) => {
      const state = get();
      if (!state.scenes.some(scene => scene.id === id))
        return;
      // Navigation is outside project history, including an existing redo branch.
      state.patch({
        ...sceneSelection(id),
        tryMode: options?.preserveTry ? state.tryMode : null,
      });
    },
    createScene: options => {
      const state = get();
      const id = `scene-${uid()}`;
      const parent = state.currentSceneId;
      const scene: Scene = {
        id, parent, name: options?.name?.trim() || nextSceneName(state.scenes, parent),
        clips: [], texts: [], components: [], muted: false, sound: 0,
      };
      state.edit({
        ...sceneSelection(id), scenes: [...state.scenes, scene],
        screen: options?.openCamera ? "camera" : "editor",
        recordingInto: options?.openCamera ? id : null,
      });
      return id;
    },
    duplicateScene: id => {
      const state = get();
      const original = state.scenes.find(scene => scene.id === id);
      if (!original || id === "main") return null;
      const newId = `scene-${uid()}`;
      const copy = duplicateSceneData(original, state.scenes, newId, uid);
      state.edit({ ...sceneSelection(newId), scenes: [...state.scenes, copy] });
      return newId;
    },
    deleteScene: id => {
      const state = get();
      if (id === "main" || !state.scenes.some(scene => scene.id === id))
        return;
      const deleted = sceneSubtreeIds(state.scenes, id);
      const scenes = state.scenes.filter(scene => !deleted.has(scene.id)).map(scene => ({
        ...scene,
        components: scene.components.map(component => clearDeletedComponentRoutes(component, deleted)),
      }));
      const parent = state.scenes.find(scene => scene.id === id)?.parent ?? "main";
      const currentSceneId = deleted.has(state.currentSceneId) ? parent : state.currentSceneId;
      state.edit({ ...sceneSelection(currentSceneId), scenes });
    },
    startRecordingIntoScene: id => {
      const state = get();
      if (!state.scenes.some(scene => scene.id === id))
        return;
      state.patch({ ...sceneSelection(id), screen: "camera", recordingInto: id === "main" ? null : id });
    },
    cancelRecordingIntoScene: () => {
      const state = get();
      const id = state.recordingInto;
      if (!id)
        return;
      const scene = state.scenes.find(item => item.id === id);
      const emptyLeaf = scene && !scene.clips.length && !scene.texts.length
        && !scene.components.length && !sceneChildren(state.scenes, id).length;
      if (id !== "main" && emptyLeaf) {
        state.deleteScene(id);
      }
      else
        state.patch({ recordingInto: null, screen: "editor", playing: false });
    },
    updateScene: (id, changes, undoable = true) => {
      const state = get();
      if (!state.scenes.some(scene => scene.id === id))
        return;
      if (changes.parent !== undefined && !canReparentScene(state.scenes, id, changes.parent)) return;
      const scenes = state.scenes.map(scene => scene.id === id ? { ...scene, ...changes, id } : scene);
      if (undoable)
        state.edit({ scenes });
      else
        state.patch({ scenes });
    }
  };
}
