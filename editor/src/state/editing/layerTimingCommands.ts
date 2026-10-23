import { beginAudioTimingDrag } from "./audioCommands";
import { beginComponentTimingDrag } from "../components/componentTimingDrag";
import { beginTimelineTimingDrag } from "./timelineTimingDrag";
import { beginMusicTimingDrag } from "./musicTimingDrag";
import type { LayerId } from "../../domain/layers/model";

export type LayerTimingMode = "move" | "l" | "r";
export function beginLayerTimingDrag(id: LayerId, mode: LayerTimingMode) {
  if (id === "music") return beginMusicTimingDrag(mode);
  if (id.startsWith("audio:"))
    return beginAudioTimingDrag(Number(id.slice(6)), mode);
  if (id.startsWith("component:"))
    return beginComponentTimingDrag(
      id.slice(10),
      mode === "l" ? "start" : mode === "r" ? "end" : "move",
    );
  if (id.startsWith("text:"))
    return beginTimelineTimingDrag({
      kind: "text",
      id: Number(id.slice(5)),
      mode,
    });
  return null;
}
