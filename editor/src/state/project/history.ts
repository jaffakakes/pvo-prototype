import { sceneDuration } from "../../domain/scenes/duration";
import { layerOrder } from "../../domain/layers/order";
import type { ProjectSnapshot } from "../../domain/project/model";
import { clamp } from "../../domain/project/numbers";
import { cloneScenes } from "../../domain/project/snapshot";
import { normalizeSceneTree } from "../../domain/scenes/rules";
import type { CaptureState } from "../types";

export const projectSnapshot = (state: CaptureState): ProjectSnapshot => ({
  scenes: cloneScenes(normalizeSceneTree(state.scenes)), currentSceneId: state.currentSceneId, ratio: state.ratio,
  coverAt: state.coverAt, allowedDomains: state.allowedDomains.slice(),
});
export function restore(state: CaptureState, project: ProjectSnapshot): Partial<CaptureState> {
  const scenes = cloneScenes(normalizeSceneTree(project.scenes));
  const active = scenes.find(scene => scene.id === project.currentSceneId) ?? scenes.find(scene => scene.id === "main")!;
  const switched = active.id !== state.currentSceneId;
  const t = clamp(switched ? 0 : state.t, 0, sceneDuration(active));
  const sel = switched || !active.clips.length ? -1 : Math.min(state.sel, active.clips.length - 1);
  const selComp = !switched && active.components.some(component => component.id === state.selComp) ? state.selComp : null;
  const selText = !switched && active.texts.some(text => text.id === state.selText) ? state.selText : null;
  const pick = state.playheadPick;
  const pickValid = !switched && pick && pick.sceneId === active.id && (pick.kind === "text-start"
    ? active.texts.some(text => text.id === pick.textId)
    : active.components.some(component => component.id === pick.componentId));
  return {
    scenes, currentSceneId: active.id, ratio: project.ratio, coverAt: project.coverAt,
    allowedDomains: project.allowedDomains?.slice() ?? [],
    clips: active.clips, audioClips: active.audioClips ?? [], texts: active.texts, components: active.components, muted: active.muted, sound: active.sound,
    t, sel, selComp, selText, selAudio: null, layers: layerOrder(active), playing: false, trim: null, orb: false,
    screen: state.screen, playheadPick: pickValid ? pick : null,
    ...(switched ? { sheet: null, tryMode: null } : {}),
    recordingInto: state.screen === "camera" && active.id !== "main" ? active.id : null,
    exportFormat: "pvo",
  };
}
