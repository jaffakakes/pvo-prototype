export type VisualLayerId = "video" | `text:${number}` | `component:${string}`;
export type LayerId = VisualLayerId | `audio:${number}` | "music";
export type LayerType = "video" | "text" | "component" | "audio" | "music";
export function layerType(id: LayerId): LayerType {
  if (id === "video" || id === "music") return id;
  if (id.startsWith("text:")) return "text";
  if (id.startsWith("audio:")) return "audio";
  return "component";
}
export function isVisualLayer(id: LayerId): id is VisualLayerId {
  const type = layerType(id);
  return type === "video" || type === "text" || type === "component";
}
