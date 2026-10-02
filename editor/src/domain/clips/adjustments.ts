import type { Clip } from "../project/model";

/** Clip adjustments share one immutable update boundary. */
export function adjustClip(clip: Clip, values: Partial<Clip>): Clip {
  return { ...clip, ...values };
}
