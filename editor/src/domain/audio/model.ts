import type { LayerAnimation } from "../animation/model";

/** An independent use of a source video's sound, with its own timeline timing. */
export type AudioClip = {
  id: number;
  name: string;
  url: string | null;
  srcDur: number;
  in: number;
  out: number;
  speed: number;
  start: number;
  muted: boolean;
  /** Linear amplitude; absent values play at full volume. */
  gain?: number;
  /** Gain curves use original-source seconds. */
  animation?: LayerAnimation;
};
