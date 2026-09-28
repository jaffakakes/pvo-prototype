import type { LayerId } from "../../domain/layers/model";

export const PPS = 50;
export const LEAD = 64;
// 8px inset + 100px labels + 15px clear space in the narrow editor.
export const PLAYHEAD_X = 123;
export const stripLeft = (time: number, shift = 0, playheadX = PLAYHEAD_X) => playheadX - LEAD - time * PPS + shift;
export function timelineRows(order: LayerId[]) {
  let top = 30;
  return order.slice().reverse().map(id => {
    const height = id === "video" ? 64 : 34;
    const row = { id, top, height, center: top + height / 2 };
    top += height;
    return row;
  });
}
/** Use the original row positions throughout a drag so live reordering cannot jitter. */
export function dragLayer(order: LayerId[], id: LayerId, deltaY: number): LayerId[] {
  const rows = timelineRows(order), source = rows.find(row => row.id === id);
  if (!source)
    return order.slice();
  const others = rows.filter(row => row.id !== id);
  const index = others.filter(row => row.center < source.center + deltaY).length;
  const frontToBack = others.map(row => row.id);
  frontToBack.splice(index, 0, id);
  return frontToBack.reverse();
}
