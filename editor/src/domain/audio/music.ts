import type { LayerAnimation } from "../animation/model";

/** An authored catalogue loop with an explicit timeline interval and source clock. */
export type MusicLayer = {
  track: number;
  start: number;
  duration: number;
  offset: number;
  gain: number;
  animation?: LayerAnimation;
};

export function musicTime(music: MusicLayer, sceneTime: number): number {
  return music.offset + sceneTime - music.start;
}
export function musicPlaying(
  music: MusicLayer | null | undefined,
  time: number,
): boolean {
  return !!music && time >= music.start && time < music.start + music.duration;
}
export function dragMusic(
  music: MusicLayer,
  mode: "move" | "l" | "r",
  delta: number,
): MusicLayer {
  if (!Number.isFinite(delta)) return music;
  if (mode === "move")
    return { ...music, start: Math.max(0, music.start + delta) };
  if (mode === "r")
    return { ...music, duration: Math.max(0.05, music.duration + delta) };
  const shift = Math.max(
    -Math.min(music.start, music.offset),
    Math.min(delta, music.duration - 0.05),
  );
  return {
    ...music,
    start: music.start + shift,
    offset: music.offset + shift,
    duration: music.duration - shift,
  };
}

export function assertMusicLayer(value: MusicLayer | null | undefined): void {
  if (value == null) return;
  if (
    !Number.isInteger(value.track) ||
    value.track < 1 ||
    value.track > 4 ||
    !Number.isFinite(value.start) ||
    value.start < 0 ||
    !Number.isFinite(value.duration) ||
    value.duration < 0.05 ||
    !Number.isFinite(value.offset) ||
    value.offset < 0 ||
    !Number.isFinite(value.gain) ||
    value.gain < 0 ||
    value.gain > 1
  )
    throw new Error(
      "Music needs a valid source, timeline range, source offset and gain.",
    );
}
