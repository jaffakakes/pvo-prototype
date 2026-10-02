import type { AudioClip } from "./model";
import type { Scene } from "../project/model";

/** Linear amplitude, shared by authoring, playback and export. */
export function audioGain(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

export function changeAudioGain(clip: AudioClip, gain: number): AudioClip {
  return { ...clip, gain: audioGain(gain) };
}

export function changeSceneAudioGain(scene: Scene, target: "music" | "clip", gain: number): Scene {
  return target === "music" ? { ...scene, musicGain: audioGain(gain) } : { ...scene, clipGain: audioGain(gain) };
}
