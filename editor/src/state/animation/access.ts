import type { AnimationTarget } from "../../domain/animation/model";
import { useAssistant } from "../assistant/assistantStore";
import type { CaptureState } from "../types";

export function canAuthorAnimation(state: CaptureState): boolean {
  return state.screen === "editor" && !state.recording && !state.importing && !state.tryMode && !state.playheadPick
    && !state.trim && state.ex !== "running" && useAssistant.getState().phase === "idle";
}

export function selectedAuthoringTarget(state: CaptureState): AnimationTarget | null {
  if (state.selComp != null && state.components.some(item => item.id === state.selComp)) return { kind: "component", id: state.selComp };
  if (state.selText != null && state.texts.some(item => item.id === state.selText)) return { kind: "text", id: state.selText };
  if (state.selAudio != null && state.audioClips.some(item => item.id === state.selAudio)) return { kind: "audio", id: state.selAudio };
  if (state.clips[state.sel]) return { kind: "clip", id: state.clips[state.sel].id };
  return state.sound > 0 && (state.sheet === "sound" || state.sheet === "animation") ? { kind: "music" } : null;
}

export function sameAnimationTarget(left: AnimationTarget | null, right: AnimationTarget | null): boolean {
  return left?.kind === right?.kind && (left?.kind === "music" || (left && right && "id" in left && "id" in right && left.id === right.id)) === true;
}
