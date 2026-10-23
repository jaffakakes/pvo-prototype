import type { LayerId } from "../../domain/layers/model";

export const PPS = 50;
export const LEAD = 64;
// Only the time ruler occupies the timeline header.
export const TIMELINE_HEADER_HEIGHT = 24;
// Leave room for the layer handle and a 56px cover tile before the first clip.
export const PLAYHEAD_X = 131;
export const stripLeft = (time: number, shift = 0, playheadX = PLAYHEAD_X) =>
  playheadX - LEAD - time * PPS + shift;
export function timelineRows(order: LayerId[]) {
  let top = TIMELINE_HEADER_HEIGHT;
  return order
    .slice()
    .reverse()
    .map((id) => {
      const height = id === "video" ? 64 : 34;
      const row = { id, top, height, center: top + height / 2 };
      top += height;
      return row;
    });
}
/** Use the original row positions throughout a drag so live reordering cannot jitter. */
export type LayerRowGeometry = { id: LayerId; top: number; center: number };
export function dragLayerRows(
  order: LayerId[],
  id: LayerId,
  deltaY: number,
  rows: LayerRowGeometry[],
): LayerId[] {
  const source = rows.find((row) => row.id === id);
  if (!source) return order.slice();
  const others = rows.filter((row) => row.id !== id);
  const index = others.filter(
    (row) => row.center < source.center + deltaY,
  ).length;
  const frontToBack = others.map((row) => row.id);
  frontToBack.splice(index, 0, id);
  return frontToBack.reverse();
}
export function dragLayer(
  order: LayerId[],
  id: LayerId,
  deltaY: number,
): LayerId[] {
  return dragLayerRows(order, id, deltaY, timelineRows(order));
}
