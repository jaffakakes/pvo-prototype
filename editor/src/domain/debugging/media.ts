export type DebugMediaSample = {
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  readyState: number;
  failed: boolean;
};

/** The final video frame remains media-owned unless the scene has a real layer tail. */
export function mediaOwnsDiagnosticClock(videoTime: number, mediaDuration: number, sceneDuration: number, hasMedia: boolean): boolean {
  return hasMedia && !(sceneDuration > mediaDuration && videoTime >= mediaDuration);
}

export function observedMediaEvent(sample: DebugMediaSample, waiting = false): "media.error" | "media.ended" | "media.seeking" | "media.paused" | "media.waiting" | "media.playing" {
  if (sample.failed) return "media.error";
  if (sample.ended) return "media.ended";
  if (sample.seeking) return "media.seeking";
  if (sample.paused) return "media.paused";
  if (waiting || sample.readyState < 2) return "media.waiting";
  return "media.playing";
}
