import { create } from "zustand";
import { createComponentActions } from "./components/componentActions";
import { projectSnapshot, restore } from "./project/history";
import { initial } from "./project/initial";
import { createLayerActions } from "./editing/layerActions";
import { createSceneActions } from "./scenes/sceneActions";
import { applyValues } from "./project/sceneSync";
import { createSessionActions } from "./project/sessionActions";
import { createTextActions } from "./editing/textActions";
import type { CaptureState } from "./types";
import { taskLinksForProject } from "../domain/assistant/taskProjectLink";

function projectValues(
  state: CaptureState,
  values: Partial<CaptureState>,
): Partial<CaptureState> {
  return {
    ...applyValues(state, values),
    assistantTaskLinks: taskLinksForProject(
      values.assistantTaskLinks === undefined
        ? state.assistantTaskLinks
        : values.assistantTaskLinks,
      values.localId === undefined ? state.localId : values.localId,
    ),
  };
}

export const useCapture = create<CaptureState>((set, get) => ({
  ...initial(),
  patch: (values) => set((state) => projectValues(state, values)),
  edit: (values) =>
    set((state) => ({
      ...projectValues(state, values),
      past: [...state.past, projectSnapshot(state)].slice(-40),
      future: [],
    })),
  undo: () =>
    set((state) => {
      if (!state.past.length) return state;
      const project = state.past[state.past.length - 1];
      return {
        ...restore(state, project),
        past: state.past.slice(0, -1),
        future: [projectSnapshot(state), ...state.future].slice(0, 40),
      };
    }),
  redo: () =>
    set((state) => {
      if (!state.future.length) return state;
      const project = state.future[0];
      return {
        ...restore(state, project),
        past: [...state.past, projectSnapshot(state)].slice(-40),
        future: state.future.slice(1),
      };
    }),
  ...createSceneActions(get),
  ...createComponentActions(get),
  ...createTextActions(get),
  ...createLayerActions(get),
  ...createSessionActions(set, get),
}));
