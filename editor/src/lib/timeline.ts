import type { Clip } from "../store";

export const PPS = 50;
export const LEAD = 64;
export const MID = 212;
export const dur = (clip: Clip) => (clip.out - clip.in) / clip.speed;
export const total = (clips: Clip[]) => clips.reduce((value, clip) => value + dur(clip), 0);
export function locate(time: number, clips: Clip[]) {
  let start = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const length = dur(clip);
    if (time < start + length || i === clips.length - 1) {
      return { i, c: clip, start, d: length, lt: Math.min(clip.out, clip.in + Math.max(0, time - start) * clip.speed) };
    }
    start += length;
  }
  return null;
}
export const stripLeft = (time: number, shift = 0) => MID - LEAD - time * PPS + shift;
