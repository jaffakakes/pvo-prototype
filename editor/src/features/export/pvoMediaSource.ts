import { layerOrder } from "../../domain/layers/order";
import type { Scene } from "../../domain/project/model";
import type { ExportSnapshot } from "../../domain/publishing/model";
import type { VideoExportSource } from "../../infrastructure/media/exportVideo";

/** Keep native text and visual animation live; the exported scene owns the audio mix. */
export function pvoSceneMediaSource(
  state: Pick<ExportSnapshot, "ratio" | "quality">,
  scene: Scene,
): VideoExportSource {
  return {
    ...scene,
    includeText: false,
    includeVideoAnimation: false,
    ratio: state.ratio,
    quality: state.quality,
    layers: [...layerOrder(scene).filter((id) => id !== "video"), "video"],
  };
}
