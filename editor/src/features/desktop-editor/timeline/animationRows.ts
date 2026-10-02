import { animatedAuthoringGroups } from "../../../domain/animation/authoring";
import type { AnimationTarget } from "../../../domain/animation/model";
import type { Scene } from "../../../domain/project/model";
import type { AnimationLane } from "../../animation/timeline/model";
import type { DesktopLayerLayout, DesktopLayerRow } from "./layerRows";

export function selectedAnimationLanes(
  scene: Scene | undefined,
  target: AnimationTarget | null,
  single: boolean,
): AnimationLane[] {
  if (!scene || !target) return [];
  const groups = animatedAuthoringGroups(scene, target);
  return single && groups.length
    ? [{ target, groups, single }]
    : groups.map((group) => ({ target, groups: [group], single }));
}

/** Insert property rows directly below the selected visual layer's packed row. */
export function withAnimationRows(
  layout: DesktopLayerLayout,
  lanes: AnimationLane[],
): DesktopLayerLayout {
  const target = lanes[0]?.target;
  if (!target || target.kind === "audio" || target.kind === "music")
    return layout;
  const layerId =
    target.kind === "clip" ? "video" : `${target.kind}:${target.id}`;
  const rows: DesktopLayerRow[] = layout.rows.flatMap((row) => {
    if (!row.layerIds.some((id) => id === layerId)) return [row];
    return [
      row,
      ...lanes.map(
        (lane, index): DesktopLayerRow => ({
          id: `animation:${index}`,
          kind: "animation",
          layerIds: [],
          lane,
        }),
      ),
    ];
  });
  const rowIndexByLayer: DesktopLayerLayout["rowIndexByLayer"] = {};
  rows.forEach((row, index) =>
    row.layerIds.forEach((id) => {
      rowIndexByLayer[id] = index;
    }),
  );
  return { rows, rowIndexByLayer };
}
