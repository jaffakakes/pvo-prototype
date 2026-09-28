import type { Clip } from "../project/model";
import { locate, total } from "./timing";

/** Library additions follow the whole clip containing the playhead. */
export function insertClipsAtPlayhead(clips: Clip[], additions: Clip[], playhead: number) {
  const underPlayhead = locate(playhead, clips);
  const index = underPlayhead ? underPlayhead.i + 1 : clips.length;
  return {
    clips: [...clips.slice(0, index), ...additions, ...clips.slice(index)],
    index,
    time: total(clips.slice(0, index)),
  };
}
