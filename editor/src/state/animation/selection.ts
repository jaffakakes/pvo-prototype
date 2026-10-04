import { create } from "zustand";
import { getAuthoringKeys, type AnimationGroup } from "../../domain/animation/authoring";
import { KEYFRAME_TIME_EPSILON } from "../../domain/animation/editing";
import type { AnimationTarget } from "../../domain/animation/model";
import { useCapture } from "../captureStore";
import { canAuthorAnimation, sameAnimationTarget, selectedAuthoringTarget } from "./access";

export type AnimationSelection = { sceneId: string; target: AnimationTarget; group: AnimationGroup; time: number };
type AnimationSelectionState = {
  selection: AnimationSelection | null;
  select(selection: AnimationSelection): void;
  clear(): void;
};

/** Key selection is a transient editing affordance, never part of project snapshots. */
export const useAnimationSelection = create<AnimationSelectionState>((set) => ({
  selection: null,
  clear: () => set({ selection: null }),
  select: selection => {
    const state = useCapture.getState();
    const scene = state.scenes.find(item => item.id === selection.sceneId);
    const key = scene && getAuthoringKeys(scene, selection.target, selection.group)
      .find(item => Math.abs(item.time - selection.time) < KEYFRAME_TIME_EPSILON);
    if (!canAuthorAnimation(state) || state.currentSceneId !== selection.sceneId || !key) {
      set({ selection: null });
      return;
    }
    const target = selection.target;
    state.patch({ t: key.time, playing: false, sel: target.kind === "clip" ? scene!.clips.findIndex(item => item.id === target.id) : -1,
      selComp: target.kind === "component" ? target.id : null,
      selText: target.kind === "text" ? target.id : null,
      selAudio: target.kind === "audio" ? target.id : null });
    set({ selection: { ...selection, target: { ...target }, time: key.time } });
  },
}));

/** A stage drag edits a position key only after that key is explicitly selected at the playhead. */
export function selectedPositionKeyAt(sceneId: string, target: AnimationTarget, time: number): boolean {
  const selection = useAnimationSelection.getState().selection;
  return !!selection && selection.sceneId === sceneId && selection.group === "position"
    && sameAnimationTarget(selection.target, target)
    && Math.abs(selection.time - time) < KEYFRAME_TIME_EPSILON;
}

// Undo, project/layer switches and deletion must never leave Delete targeting an old hidden key.
useCapture.subscribe((state, previous) => {
  const selection = useAnimationSelection.getState().selection;
  if (!selection) return;
  const scene = state.scenes.find(item => item.id === selection.sceneId);
  if (state.localId !== previous.localId || state.currentSceneId !== selection.sceneId
    || state.past !== previous.past || state.future !== previous.future
    || !sameAnimationTarget(selectedAuthoringTarget(state), selection.target)
    || !scene || !getAuthoringKeys(scene, selection.target, selection.group)
      .some(key => Math.abs(key.time - selection.time) < KEYFRAME_TIME_EPSILON))
    useAnimationSelection.getState().clear();
});
