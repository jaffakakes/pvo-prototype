import { CLIP_COLORS } from "../../domain/clips/defaults";
import type { Clip } from "../../domain/project/model";
import { uid } from "../../infrastructure/ids";

export const mkClip = (
  length: number,
  url: string | null,
  index: number,
  width = 9,
  height = 16,
  fit: Clip["fit"] = "contain",
): Clip => ({
  id: uid(),
  url,
  color: CLIP_COLORS[index % CLIP_COLORS.length],
  srcDur: length,
  in: 0,
  out: length,
  speed: 1,
  zoom: 1,
  mirror: false,
  width,
  height,
  fit,
});
