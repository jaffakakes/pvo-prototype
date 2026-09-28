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
};
