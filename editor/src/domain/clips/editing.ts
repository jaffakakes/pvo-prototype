import type { Clip } from "../project/model";
import { locate } from "./timing";

/** Split times use the source clip's speed and leave both pieces at least 150ms long. */
export function splitClipAt(clips: Clip[], time: number, createId: () => number) {
  const located = locate(time, clips);
  if (!located || located.lt - located.c.in < .15 * located.c.speed || located.c.out - located.lt < .15 * located.c.speed) {
    return null;
  }
  const updated = [...clips];
  updated.splice(located.i, 1, { ...located.c, out: located.lt }, { ...located.c, id: createId(), in: located.lt });
  return { clips: updated, selectedIndex: located.i + 1 };
}
export function removeClipAt(clips: Clip[], index: number): Clip[] {
  return clips.filter((_, clipIndex) => clipIndex !== index);
}
