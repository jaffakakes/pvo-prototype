import type { LayerId } from "../../../domain/layers/model";
import {
  layerOrder,
  type LayerSource,
} from "../../../domain/layers/order";

export type DesktopLayerRow =
  | { id: "add:components"; kind: "empty-components"; layerId: null }
  | { id: "add:text"; kind: "empty-text"; layerId: null }
  | { id: LayerId; kind: "component" | "text" | "video"; layerId: LayerId };

function layerKind(id: LayerId): "component" | "text" | "video" {
  if (id === "video") return "video";
  return id.startsWith("text:") ? "text" : "component";
}

/** Front-to-back rows, matching the overlay stack viewers see in the player. */
export function desktopLayerRows(source: LayerSource): DesktopLayerRow[] {
  const rows: DesktopLayerRow[] = layerOrder(source)
    .slice()
    .reverse()
    .map((id) => ({
      id,
      layerId: id,
      kind: layerKind(id),
    }));

  if (!source.texts.length)
    rows.unshift({ id: "add:text", kind: "empty-text", layerId: null });
  if (!source.components.length)
    rows.unshift({ id: "add:components", kind: "empty-components", layerId: null });

  return rows;
}
