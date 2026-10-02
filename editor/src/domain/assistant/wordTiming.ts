import type { NativeObservation, NativeObservationRequest, WordAlignment } from "../../../../packages/pvo-assistant/native/index.js";
import { audioGain } from "../audio/gain";
import type { Clip } from "../project/model";
import { inspectionScene, type InspectionProject } from "./mediaInspection";

export type WordTimingRequest = Extract<NativeObservationRequest, { kind: "word_timing" }>;
export type WordTimingObservation = Extract<NativeObservation, { kind: "word_timing" }>;
type SourceMedia = Pick<Clip, "id" | "url" | "srcDur" | "in" | "out" | "speed">;
type AuthoredSource = { reference: WordTimingRequest["source"]; media: SourceMedia; sceneStart: number; audible: boolean };
export type WordTimingSource = {
  id: number;
  url: string;
  sourceDuration: number;
  sourceStart: number;
  sourceEnd: number;
  sourceIn: number;
  sceneStart: number;
  speed: number;
};

const EPSILON = 0.000001;

function sourceEnd(source: AuthoredSource): number {
  const { media, sceneStart } = source;
  if (![media.srcDur, media.in, media.out, media.speed, sceneStart].every(Number.isFinite)
    || sceneStart < 0 || media.in < 0 || media.out <= media.in || media.out > media.srcDur + EPSILON
    || media.speed < 0.25 || media.speed > 4)
    throw new Error("The selected scene contains an invalid audio source range.");
  return sceneStart + (media.out - media.in) / media.speed;
}

/** Resolve one audible authored source; never align a mixture or infer a source ID. */
export function inspectionWordTiming(project: InspectionProject, request: WordTimingRequest): WordTimingSource {
  const scene = inspectionScene(project, request);
  const sources: AuthoredSource[] = [];
  let start = 0;
  for (const clip of scene.clips) {
    const source = { reference: { kind: "clip" as const, id: clip.id }, media: clip, sceneStart: start,
      audible: !scene.muted && !clip.audioDetached && audioGain(scene.clipGain) > 0 };
    start = sourceEnd(source);
    sources.push(source);
  }
  for (const audio of scene.audioClips ?? []) {
    const source = { reference: { kind: "audio" as const, id: audio.id }, media: audio, sceneStart: audio.start,
      audible: !audio.muted && audioGain(audio.gain) > 0 };
    sourceEnd(source);
    sources.push(source);
  }
  const matches = sources.filter(source => source.reference.kind === request.source.kind && source.reference.id === request.source.id);
  if (matches.length !== 1) throw new Error("Choose one existing audio source from the current scene.");
  const selected = matches[0];
  if (!selected.audible || !selected.media.url) throw new Error("The selected source has no audible project audio.");
  if (request.start < selected.sceneStart - EPSILON || request.end > sourceEnd(selected) + EPSILON)
    throw new Error("Choose a timing range entirely inside the selected authored source.");
  if (sources.some(source => source !== selected && source.audible
    && source.sceneStart < request.end && sourceEnd(source) > request.start))
    throw new Error("Overlapping audio sources make this timing range ambiguous. Choose a range with one audible source.");
  const sourceStart = Math.max(selected.media.in, selected.media.in + (request.start - selected.sceneStart) * selected.media.speed);
  const end = Math.min(selected.media.out, selected.media.in + (request.end - selected.sceneStart) * selected.media.speed);
  if (end <= sourceStart) throw new Error("Choose a timing range with some original source audio.");
  if (end - sourceStart > 60) throw new Error("Align at most 60 seconds of original source audio at a time.");
  return { id: selected.media.id, url: selected.media.url, sourceDuration: selected.media.srcDur,
    sourceStart, sourceEnd: end, sourceIn: selected.media.in, sceneStart: selected.sceneStart, speed: selected.media.speed };
}

/** The aligner sees natural-rate audio; all speed/trim/sequence arithmetic stays in code. */
export function mapAlignedWords(source: WordTimingSource, words: WordAlignment["words"]): WordTimingObservation["words"] {
  return words.map(word => {
    const sourceStart = source.sourceStart + word.start;
    const sourceEnd = source.sourceStart + word.end;
    return { text: word.text, sourceStart, sourceEnd,
      start: source.sceneStart + (sourceStart - source.sourceIn) / source.speed,
      end: source.sceneStart + (sourceEnd - source.sourceIn) / source.speed };
  });
}
