import { layerOrder } from "../../domain/layers/order";
import type { Scene } from "../../domain/project/model";
import type { ExportSnapshot } from "../../domain/publishing/model";
import type { VideoExportSource } from "../../infrastructure/media/exportVideo";

/** Retain native overlay timing while placing those layers behind opaque media. */
export function pvoSceneMediaSource(
  state: Pick<ExportSnapshot, "ratio" | "quality">,
  scene: Scene,
): VideoExportSource {
  return {
    ...scene,
    ratio: state.ratio,
    quality: state.quality,
    layers: [...layerOrder(scene).filter((id) => id !== "video"), "video"],
  };
}
