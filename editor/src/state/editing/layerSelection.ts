import { locate } from "../../domain/clips/timing";
import { layerType, type LayerId } from "../../domain/layers/model";
import { layerOrder } from "../../domain/layers/order";
import { useCapture } from "../captureStore";
import type { CaptureState } from "../types";

export function selectedLayerId(state: CaptureState): LayerId | null {
  if (state.selMusic && state.music) return "music";
  if (state.selAudio != null) return `audio:${state.selAudio}`;
  if (state.selComp) return `component:${state.selComp}`;
  if (state.selText != null) return `text:${state.selText}`;
  return state.sel >= 0 ? "video" : null;
}
/** Toolbar, row labels and media blocks select the same typed layer. */
export function selectTimelineLayer(id: LayerId): void {
  const state = useCapture.getState();
  if (state.tryMode || state.playheadPick || !layerOrder(state).includes(id))
    return;
  const type = layerType(id);
  state.patch({
    sel: type === "video" ? (locate(state.t, state.clips)?.i ?? 0) : -1,
    selComp: type === "component" ? id.slice(10) : null,
    selText: type === "text" ? Number(id.slice(5)) : null,
    selAudio: type === "audio" ? Number(id.slice(6)) : null,
    selMusic: type === "music",
    sheet:
      (state.sheet === "crop" || state.sheet === "keyframes") &&
      ["video", "component", "text"].includes(type)
        ? state.sheet
        : null,
    playing: false,
    orb: false,
  });
}
