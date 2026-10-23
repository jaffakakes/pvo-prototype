import type { Scene } from "../project/model";
import { isVisualLayer, type LayerId, type VisualLayerId } from "./model";

export type LayerSource = Pick<Scene, "texts" | "components" | "layers"> &
  Partial<Pick<Scene, "audioClips" | "music">>;
/** Canonical back-to-front timeline order. Every layer kind shares this list. */
export function layerOrder(scene: LayerSource): LayerId[] {
  const valid: LayerId[] = [
    ...(scene.music ? ["music" as const] : []),
    ...(scene.audioClips ?? [])
      .map((clip) => `audio:${clip.id}` as const)
      .reverse(),
    "video",
    ...scene.texts.map((text) => `text:${text.id}` as const),
    ...scene.components.map(
      (component) => `component:${component.id}` as const,
    ),
  ];
  const existing = [...new Set(scene.layers ?? valid)].filter((id) =>
    valid.includes(id),
  );
  return [...existing, ...valid.filter((id) => !existing.includes(id))];
}
/** Audio row placement never participates in compositing. */
export function visualLayerOrder(scene: LayerSource): VisualLayerId[] {
  return layerOrder(scene).filter(isVisualLayer);
}
export function layerZ(scene: LayerSource, id: VisualLayerId): number {
  return visualLayerOrder(scene).indexOf(id) + 1;
}
export function moveLayer(
  scene: LayerSource,
  id: LayerId,
  direction: "up" | "down",
): LayerId[] {
  const layers = layerOrder(scene);
  const from = layers.indexOf(id),
    to = from + (direction === "up" ? 1 : -1);
  if (from >= 0 && to >= 0 && to < layers.length)
    [layers[from], layers[to]] = [layers[to], layers[from]];
  return layers;
}
