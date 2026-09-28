import type { TextStyle } from "../../../../packages/pvo-text-runtime/index.js";
import { insertClipsAtPlayhead } from "../../domain/clips/insertion";
import type { Clip, ComponentType } from "../../domain/project/model";
import { useCapture } from "../captureStore";
import { setComponentAuthoringTab } from "../components/componentAuthoringStore";
import { mkClip } from "./clipFactory";
import type { CaptureState } from "../types";

function libraryMutationBlocked(state: CaptureState) {
  return state.tryMode !== null || state.playheadPick !== null || state.recording || state.ex === "running";
}

export function insertLibraryClips(additions: Clip[]) {
  if (!additions.length) return false;
  const state = useCapture.getState();
  if (libraryMutationBlocked(state)) return false;
  const inserted = insertClipsAtPlayhead(state.clips, additions, state.t);
  state.edit({
    clips: inserted.clips, sel: inserted.index, t: inserted.time,
    selComp: null, selText: null, playing: false, sheet: null,
  });
  return true;
}

export function addLibrarySource(source: Clip) {
  const state = useCapture.getState();
  if (state.importing || libraryMutationBlocked(state)) return;
  insertLibraryClips([mkClip(source.srcDur, source.url, state.clips.length, source.width, source.height, source.fit)]);
}

export function addLibraryComponent(type: ComponentType) {
  const before = useCapture.getState();
  if (before.importing || libraryMutationBlocked(before)) return;
  const id = before.addComponent(type);
  const state = useCapture.getState();
  // The initial add owns the undo entry; these are part of that same command.
  state.updateComponent(id, { dur: type === "tooltip" ? 3 : 5 }, false);
  state.patch({ selText: null, sheet: null });
  setComponentAuthoringTab(id, "content");
  return id;
}

export function addLibraryText(label: string, style: TextStyle, y: number) {
  const before = useCapture.getState();
  if (before.importing || libraryMutationBlocked(before)) return;
  const id = before.addText(label, style);
  const state = useCapture.getState();
  state.updateText(id, { y }, false);
  state.patch({ sel: -1, selComp: null, selText: id, sheet: null });
  return id;
}

export function selectLibraryComponent(sceneId: string, componentId: string) {
  const state = useCapture.getState();
  if (state.importing || libraryMutationBlocked(state)) return;
  if (state.currentSceneId !== sceneId) state.switchScene(sceneId);
  const current = useCapture.getState();
  const component = current.components.find(item => item.id === componentId);
  if (!component) return;
  current.patch({ sel: -1, selComp: componentId, selText: null, t: component.at, playing: false, sheet: null });
  setComponentAuthoringTab(componentId, "content");
}

export function setLibraryMusic(index: number) {
  const state = useCapture.getState();
  if (state.importing || libraryMutationBlocked(state)) return;
  if (state.sound !== index) state.edit({ sound: index });
  useCapture.getState().patch({ sheet: "sound", sel: -1, selComp: null, selText: null });
}
