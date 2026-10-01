import { componentEnd } from "../../../domain/components/timing";
import type {
  PvoComponent,
  Scene,
  TextOverlay,
} from "../../../domain/project/model";
import type { LayerId } from "../../../domain/layers/model";
import { layerOrder } from "../../../domain/layers/order";

type OverlayLayerId = Exclude<LayerId, "video">;
type OverlaySide = "front" | "back";

type TimedOverlay = {
  layerId: OverlayLayerId;
  kind: "component" | "text";
  start: number;
  end: number;
  packingStart: number;
  packingEnd: number;
  zRank: number;
  side: OverlaySide;
};

export type DesktopLayerRow =
  | { id: "add:components"; kind: "empty-components"; layerIds: [] }
  | { id: "add:text"; kind: "empty-text"; layerIds: [] }
  | { id: "video"; kind: "video"; layerIds: ["video"] }
  | {
      id: `overlay:${OverlaySide}:${number}`;
      kind: "overlay";
      side: OverlaySide;
      layerIds: OverlayLayerId[];
    };

export type DesktopLayerLayout = {
  rows: DesktopLayerRow[];
  rowIndexByLayer: Partial<Record<LayerId, number>>;
};

type LayerLayoutSource = Pick<
  Scene,
  "clips" | "texts" | "components" | "layers"
>;

const TOUCH_EPSILON = 1e-9;
const MINIMUM_OVERLAY_TARGET_PX = 28;

function packingBounds(
  start: number,
  end: number,
  pixelsPerSecond: number,
) {
  const duration = Math.max(0, end - start);
  const minimumDuration = MINIMUM_OVERLAY_TARGET_PX / pixelsPerSecond;
  const padding = Math.max(0, minimumDuration - duration) / 2;
  return {
    packingStart: start - padding,
    packingEnd: start + duration + padding,
  };
}

function overlayTiming(
  layerId: OverlayLayerId,
  texts: Map<number, TextOverlay>,
  components: Map<string, PvoComponent>,
  clips: Scene["clips"],
): Pick<TimedOverlay, "kind" | "start" | "end"> | null {
  if (layerId.startsWith("text:")) {
    const text = texts.get(Number(layerId.slice("text:".length)));
    return text
      ? { kind: "text", start: text.start, end: text.end }
      : null;
  }
  const component = components.get(layerId.slice("component:".length));
  return component
    ? {
        kind: "component",
        start: component.at,
        end: componentEnd(component, clips),
      }
    : null;
}

/**
 * Assign interaction intervals to the smallest number of tracks. Intervals
 * include each block's minimum hit target and are half-open, so targets that
 * only touch can still share a track.
 */
function packOverlayRows(
  items: TimedOverlay[],
  side: OverlaySide,
): Extract<DesktopLayerRow, { kind: "overlay" }>[] {
  const lanes: { freeAt: number; layerIds: OverlayLayerId[] }[] = [];
  const sorted = items.slice().sort((a, b) => {
    if (a.packingStart !== b.packingStart)
      return a.packingStart - b.packingStart;
    if (a.zRank !== b.zRank) return b.zRank - a.zRank;
    return a.layerId.localeCompare(b.layerId);
  });

  for (const item of sorted) {
    let laneIndex = lanes.findIndex(
      (lane) => lane.freeAt <= item.packingStart + TOUCH_EPSILON,
    );
    if (laneIndex < 0) {
      laneIndex = lanes.length;
      lanes.push({ freeAt: item.packingEnd, layerIds: [] });
    }
    const lane = lanes[laneIndex];
    lane.layerIds.push(item.layerId);
    lane.freeAt = Math.max(lane.freeAt, item.packingEnd);
  }

  return lanes.map((lane, index) => ({
    id: `overlay:${side}:${index}`,
    kind: "overlay",
    side,
    layerIds: lane.layerIds,
  }));
}

/**
 * Desktop presentation rows derived from layer z-order and timing. Tracks are
 * not stored in the project: moving or trimming an item repacks them live.
 */
export function desktopLayerLayout(
  source: LayerLayoutSource,
  pixelsPerSecond: number,
): DesktopLayerLayout {
  const ordered = layerOrder(source);
  const videoIndex = ordered.indexOf("video");
  const textById = new Map(source.texts.map((text) => [text.id, text]));
  const componentById = new Map(
    source.components.map((component) => [component.id, component]),
  );
  const overlays = ordered.flatMap<TimedOverlay>((layerId, zRank) => {
    if (layerId === "video") return [];
    const timing = overlayTiming(
      layerId,
      textById,
      componentById,
      source.clips,
    );
    if (!timing) return [];
    return [
      {
        layerId,
        zRank,
        side: zRank > videoIndex ? "front" : "back",
        ...timing,
        ...packingBounds(timing.start, timing.end, pixelsPerSecond),
      },
    ];
  });

  const rows: DesktopLayerRow[] = [];
  if (!source.components.length)
    rows.push({ id: "add:components", kind: "empty-components", layerIds: [] });
  if (!source.texts.length)
    rows.push({ id: "add:text", kind: "empty-text", layerIds: [] });
  rows.push(
    ...packOverlayRows(
      overlays.filter((item) => item.side === "front"),
      "front",
    ),
    { id: "video", kind: "video", layerIds: ["video"] },
    ...packOverlayRows(
      overlays.filter((item) => item.side === "back"),
      "back",
    ),
  );

  const rowIndexByLayer: DesktopLayerLayout["rowIndexByLayer"] = {};
  rows.forEach((row, rowIndex) => {
    row.layerIds.forEach((layerId) => {
      rowIndexByLayer[layerId] = rowIndex;
    });
  });
  return { rows, rowIndexByLayer };
}
