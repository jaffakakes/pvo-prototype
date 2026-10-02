import { changeAudioGain, changeSceneAudioGain } from "../../domain/audio/gain";
import { useCapture } from "../captureStore";
import { useAssistant } from "../assistant/assistantStore";

function editable() {
  const state = useCapture.getState();
  return !state.recording && !state.importing && !state.tryMode && !state.playheadPick
    && state.ex !== "running" && useAssistant.getState().phase === "idle";
}

export function setSceneAudioGain(sceneId: string, target: "music" | "clip", gain: number, undoable = true): boolean {
  const state = useCapture.getState();
  const scene = state.scenes.find(item => item.id === sceneId);
  if (!scene || !editable()) return false;
  const next = changeSceneAudioGain(scene, target, gain);
  if (next.musicGain === scene.musicGain && next.clipGain === scene.clipGain) return false;
  const values = { scenes: state.scenes.map(item => item.id === sceneId ? next : item) };
  if (undoable) state.edit(values);
  else state.patch(values);
  return true;
}

export function setAudioClipGain(sceneId: string, audioId: number, gain: number, undoable = true): boolean {
  const state = useCapture.getState();
  const scene = state.scenes.find(item => item.id === sceneId);
  const audio = scene?.audioClips?.find(item => item.id === audioId);
  if (!scene || !audio || !editable()) return false;
  const next = changeAudioGain(audio, gain);
  if (next.gain === audio.gain) return false;
  const audioClips = scene.audioClips!.map(item => item.id === audioId ? next : item);
  const values = { scenes: state.scenes.map(item => item.id === sceneId ? { ...scene, audioClips } : item) };
  if (undoable) state.edit(values);
  else state.patch(values);
  return true;
}
