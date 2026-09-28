import { layerOrder } from "../../domain/layers/order";
import { componentCount, normalizeSceneTree } from "../../domain/scenes/rules";
import type { CaptureState } from "../types";

const has = (values: Partial<CaptureState>, key: keyof CaptureState) => Object.prototype.hasOwnProperty.call(values, key);
const sceneSyncKeys = new Set<string>([
  "scenes", "currentSceneId", "clips", "audioClips", "texts", "components", "muted", "sound", "layers",
  "screen", "sel", "selComp", "selText", "selAudio", "exportFormat",
]);
// Keep one active-scene mirror for legacy calls while storing all project media in scenes.
export function applyValues(state: CaptureState, values: Partial<CaptureState>): Partial<CaptureState> {
  // Playback and other UI-only patches cannot change scene mirrors or their derived selections.
  if (!Object.keys(values).some(key => sceneSyncKeys.has(key)))
    return values;
  let scenes = normalizeSceneTree(values.scenes ?? state.scenes);
  const requestedId = values.currentSceneId ?? state.currentSceneId;
  const currentSceneId = scenes.some(scene => scene.id === requestedId) ? requestedId : "main";
  const scoped = has(values, "audioClips") || has(values, "clips") || has(values, "texts") || has(values, "components") || has(values, "muted") || has(values, "sound") || has(values, "layers");
  if (scoped) {
    scenes = scenes.map(scene => scene.id === currentSceneId ? {
      ...scene,
      clips: values.clips ?? scene.clips,
      audioClips: values.audioClips ?? scene.audioClips,
      texts: values.texts ?? scene.texts,
      components: values.components ?? scene.components,
      muted: values.muted ?? scene.muted,
      sound: values.sound ?? scene.sound,
      layers: values.layers ?? scene.layers,
    } : scene);
  }
  scenes = scenes.map(scene => ({ ...scene, layers: layerOrder(scene) }));
  const active = scenes.find(scene => scene.id === currentSceneId)!;
  const switched = currentSceneId !== state.currentSceneId;
  let recordingInto = has(values, "recordingInto") ? values.recordingInto! : state.recordingInto;
  if (!has(values, "recordingInto") && values.screen === "camera" && currentSceneId !== "main")
    recordingInto = currentSceneId;
  if (!has(values, "recordingInto") && values.screen === "editor")
    recordingInto = null;
  const count = componentCount(scenes);
  const exportFormat = has(values, "exportFormat") ? values.exportFormat! :
    count === 0 ? "video" : componentCount(state.scenes) === 0 ? "pvo" : state.exportFormat;
  const selected = values.sel ?? (switched ? -1 : state.sel);
  let selComp = has(values, "selComp") ? values.selComp! : switched ? null : state.selComp;
  let selText = has(values, "selText") ? values.selText! : switched ? null : state.selText;
  if (has(values, "sel") || (has(values, "selComp") && values.selComp))
    selText = null;
  if (has(values, "selText") && values.selText != null) {
    selText = values.selText;
    selComp = null;
  }
  if (!active.texts.some(text => text.id === selText))
    selText = null;
  if (!active.components.some(component => component.id === selComp))
    selComp = null;
  if (selected >= 0 && has(values, "sel"))
    selComp = null;
  let selAudio = has(values, "selAudio") ? values.selAudio! : switched ? null : state.selAudio;
  if (has(values, "sel") || has(values, "selComp") || has(values, "selText")) selAudio = values.selAudio ?? null;
  if (!(active.audioClips ?? []).some(clip => clip.id === selAudio)) selAudio = null;
  if (selAudio != null) { selComp = null; selText = null; }
  const sel = selComp || selText != null || selAudio != null ? -1 : selected;
  const screen = values.screen ?? state.screen;
  return {
    ...values,
    scenes, currentSceneId,
    clips: active.clips, audioClips: active.audioClips ?? [], texts: active.texts, components: active.components,
    muted: active.muted, sound: active.sound, recordingInto, exportFormat,
    sel, selComp, selText, selAudio, layers: active.layers!, screen,
    ...(switched ? { t: values.t ?? 0, trim: null, playing: values.playing ?? false } : {}),
  };
}
