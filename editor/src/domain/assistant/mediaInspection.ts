import type { NativeObservationRequest } from "../../../../packages/pvo-assistant/native/index.js";
import { dur } from "../clips/timing";
import { sceneDuration } from "../scenes/duration";
import type { Clip, ProjectSnapshot, Scene } from "../project/model";
import { audioGain } from "../audio/gain";

export const MAX_INSPECTION_FRAMES = 6;
export const MAX_TRANSCRIPT_SECONDS = 60;
export type InspectionProject = Pick<ProjectSnapshot, "scenes" | "ratio">;
export type FrameRequest = Extract<NativeObservationRequest, { kind: "frames" }>;
export type TranscriptRequest = Extract<NativeObservationRequest, { kind: "transcript" }>;
export type FrameSample = { sceneTime: number; sourceTime: number | null; clip: Clip | null };
export type AudioSample = {
  id: number;
  url: string;
  sourceDuration: number;
  sourceStart: number;
  duration: number;
  offset: number;
  speed: number;
  gain: number;
};

export function inspectionScene(project: InspectionProject, request: NativeObservationRequest): Scene {
  const scene = project.scenes.find(item => item.id === request.sceneId);
  if (!scene) throw new Error("The scene to inspect no longer exists.");
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end) || request.start < 0
    || request.end <= request.start || request.end > sceneDuration(scene) + 0.000001)
    throw new Error("Choose an inspection range inside the scene timeline.");
  return scene;
}

function checkedClip(clip: Pick<Clip, "in" | "out" | "speed" | "srcDur">) {
  if (![clip.in, clip.out, clip.speed, clip.srcDur].every(Number.isFinite)
    || clip.in < 0 || clip.out <= clip.in || clip.out > clip.srcDur + 0.000001 || clip.speed <= 0)
    throw new Error("The scene contains an invalid media range.");
}

export function frameAt(scene: Scene, sceneTime: number): FrameSample {
  let start = 0;
  for (const clip of scene.clips) {
    checkedClip(clip);
    const length = dur(clip);
    if (sceneTime >= start && sceneTime < start + length)
      return { sceneTime, clip, sourceTime: clip.in + (sceneTime - start) * clip.speed };
    start += length;
  }
  return { sceneTime, clip: null, sourceTime: null };
}

/** Sample each equal timeline interval at its midpoint, without seeking beyond a cut. */
export function inspectionFrames(scene: Scene, request: FrameRequest): FrameSample[] {
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > MAX_INSPECTION_FRAMES)
    throw new Error(`Inspect between 1 and ${MAX_INSPECTION_FRAMES} frames at a time.`);
  return Array.from({ length: request.count }, (_, index) =>
    frameAt(scene, request.start + (request.end - request.start) * (index + 0.5) / request.count));
}

/** Use audible authored sources; detached sound is included only through its own layer. */
export function inspectionAudio(scene: Scene, request: TranscriptRequest): AudioSample[] {
  if (request.end - request.start > MAX_TRANSCRIPT_SECONDS)
    throw new Error(`Transcribe at most ${MAX_TRANSCRIPT_SECONDS} seconds at a time.`);
  const samples: AudioSample[] = [];
  const add = (clip: Pick<Clip, "id" | "url" | "srcDur" | "in" | "out" | "speed">, start: number, gain: number) => {
    checkedClip(clip);
    const left = Math.max(request.start, start);
    const right = Math.min(request.end, start + (clip.out - clip.in) / clip.speed);
    if (!clip.url || right <= left || gain === 0) return;
    samples.push({ id: clip.id, url: clip.url, sourceDuration: clip.srcDur,
      sourceStart: clip.in + (left - start) * clip.speed,
      duration: right - left, offset: left - request.start, speed: clip.speed, gain });
  };
  let start = 0;
  for (const clip of scene.clips) {
    if (!scene.muted && !clip.audioDetached) add(clip, start, audioGain(scene.clipGain));
    start += dur(clip);
  }
  for (const clip of scene.audioClips ?? []) {
    if (!clip.muted) {
      if (!clip.url && clip.start < request.end && clip.start + (clip.out - clip.in) / clip.speed > request.start)
        throw new Error(`Audio source ${clip.id} is missing from the project.`);
      add(clip, clip.start, audioGain(clip.gain));
    }
  }
  if (samples.length > 32 || new Set(samples.map(sample => sample.url)).size > 8)
    throw new Error("This range contains too many audio sources. Choose a shorter range.");
  return samples;
}
