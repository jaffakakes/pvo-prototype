import { total } from "../clips/timing";
import { clamp } from "../project/numbers";
import type { Clip } from "../project/model";
import type { AudioClip } from "./model";
import { audioGain } from "./gain";

export const audioDuration = (clip: AudioClip) =>
  (clip.out - clip.in) / clip.speed;

export type AudioSource = {
  name: string;
  url: string;
  duration: number;
  start: number;
};

export function createAudioClip(id: number, source: AudioSource): AudioClip | null {
  if (
    !source.url ||
    !source.name.trim() ||
    !Number.isFinite(source.duration) ||
    source.duration < 0.1 ||
    !Number.isFinite(source.start) ||
    source.start < 0
  ) return null;
  return {
    id,
    name: source.name.trim(),
    url: source.url,
    srcDur: source.duration,
    in: 0,
    out: source.duration,
    speed: 1,
    start: source.start,
    muted: false,
    gain: 1,
  };
}
export function extractClipAudio(
  clips: Clip[],
  index: number,
  id: number,
  muted: boolean,
  gain = 1,
) {
  const clip = clips[index];
  if (!clip?.url || clip.audioDetached) return null;
  const audio: AudioClip = {
    id,
    name: `Clip ${index + 1} audio`,
    url: clip.url,
    srcDur: clip.srcDur,
    in: clip.in,
    out: clip.out,
    speed: clip.speed,
    start: total(clips.slice(0, index)),
    muted,
    gain: audioGain(gain),
    ...(clip.animation?.tracks.gain ? { animation: { tracks: { gain: clip.animation.tracks.gain.map(frame => ({ ...frame })) } } } : {}),
  };
  return {
    audio,
    clips: clips.map((item, i) =>
      i === index ? { ...item, audioDetached: true } : item,
    ),
  };
}

export function dragAudio(
  clip: AudioClip,
  mode: "move" | "l" | "r",
  delta: number,
): AudioClip {
  if (!Number.isFinite(delta)) return clip;
  if (mode === "move")
    return { ...clip, start: Math.max(0, clip.start + delta) };
  const minimum = Math.min(0.1 * clip.speed, clip.out - clip.in);
  if (mode === "l") {
    const offset = clamp(
      delta * clip.speed,
      Math.max(-clip.in, -clip.start * clip.speed),
      clip.out - clip.in - minimum,
    );
    return {
      ...clip,
      in: clip.in + offset,
      start: clip.start + offset / clip.speed,
    };
  }
  return {
    ...clip,
    out: clamp(clip.out + delta * clip.speed, clip.in + minimum, clip.srcDur),
  };
}

export function splitAudio(
  clip: AudioClip,
  time: number,
  id: number,
): AudioClip[] | null {
  const offset = time - clip.start;
  if (offset < 0.1 || offset > audioDuration(clip) - 0.1) return null;
  const cut = clip.in + offset * clip.speed;
  return [
    { ...clip, out: cut },
    { ...clip, id, start: time, in: cut },
  ];
}
