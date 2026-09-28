import type { Scene } from "../project/model";
import type { LayerId } from "./model";

export type LayerSource = Pick<Scene, "texts" | "components" | "layers">;
/** Back to front. Timeline rows display this exact stack in reverse. */
export function layerOrder(scene: LayerSource): LayerId[] {
  const valid: LayerId[] = ["video", ...scene.texts.map(t => `text:${t.id}` as const), ...scene.components.map(c => `component:${c.id}` as const)];
  const existing = [...new Set(scene.layers ?? valid)].filter(id => valid.includes(id));
  return [...existing, ...valid.filter(id => !existing.includes(id))];
}
export function layerZ(scene: LayerSource, id: LayerId): number {
  return layerOrder(scene).indexOf(id) + 1;
}
export function moveLayer(scene: LayerSource, id: LayerId, direction: "up" | "down"): LayerId[] {
  const layers = layerOrder(scene);
  const from = layers.indexOf(id), to = from + (direction === "up" ? 1 : -1);
  if (from >= 0 && to >= 0 && to < layers.length)
    [layers[from], layers[to]] = [layers[to], layers[from]];
  return layers;
}
