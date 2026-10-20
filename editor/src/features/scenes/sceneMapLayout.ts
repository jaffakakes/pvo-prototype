import type { SceneNode } from "../../domain/scenes/graph";

export type MapScene = {
  node: SceneNode;
  x: number;
  y: number;
  kind: "parent" | "current" | "child";
};
export type MapChoice = { id: string; x: number; y: number };
export type MapEdge = { path: string; label: string; x: number; y: number };
export type MapLayout = {
  scenes: MapScene[];
  choices: MapChoice[];
  edges: MapEdge[];
  width: number;
  height: number;
  ghost?: { x: number; y: number };
  frame?: { x: number; y: number; width: number; height: number };
};
const elbow = (
  x: number,
  y: number,
  endX: number,
  endY: number,
  bend: number,
) => `M${x} ${y}H${bend}V${endY}H${endX}`;

export function sceneMapLayout(
  nodes: SceneNode[],
  currentId: string,
  overview: boolean,
  availableHeight = 200,
): MapLayout {
  const current = nodes.find((node) => node.scene.id === currentId)!;
  const byId = new Map(nodes.map((node) => [node.scene.id, node]));
  const parent = byId.get(current.scene.parent ?? "");
  const targetIds = [
    ...new Set([
      ...current.children,
      ...current.routes.map((route) => route.target),
    ]),
  ].filter((id) => id !== currentId && byId.has(id));
  if (overview) {
    let leaf = 0;
    const positions = new Map<string, number>();
    for (const node of [...nodes].reverse()) {
      const kids = node.children
        .map((id) => positions.get(id))
        .filter((y): y is number => y !== undefined);
      positions.set(
        node.scene.id,
        kids.length
          ? (Math.min(...kids) + Math.max(...kids)) / 2
          : 30 + leaf++ * 64,
      );
    }
    const scenes: MapScene[] = nodes.map((node) => ({
      node,
      x: 20 + node.depth * 100,
      y: positions.get(node.scene.id)!,
      kind: node.scene.id === currentId ? "current" : "child",
    }));
    const edges: MapEdge[] = [];
    const choices: MapChoice[] = [];
    for (const entry of scenes) {
      const children = scenes.filter(
        (child) => child.node.scene.parent === entry.node.scene.id,
      );
      for (const child of children)
        edges.push({
          path: elbow(
            entry.x + 22,
            entry.y + 20,
            child.x,
            child.y + 20,
            entry.x + 60,
          ),
          label: "",
          x: 0,
          y: 0,
        });
      for (const id of new Set(
        entry.node.routes.map((route) => route.componentId),
      ))
        choices.push({ id, x: entry.x + 54, y: entry.y + 14 });
    }
    const hop = scenes.filter((entry) =>
      [currentId, parent?.scene.id, ...targetIds].includes(entry.node.scene.id),
    );
    const left = Math.min(...hop.map((entry) => entry.x)) - 10;
    const top = Math.min(...hop.map((entry) => entry.y)) - 10;
    return {
      scenes,
      choices,
      edges,
      width: Math.max(...scenes.map((entry) => entry.x)) + 64,
      height: leaf * 64 + 40,
      frame: {
        x: left,
        y: top,
        width: Math.max(...hop.map((entry) => entry.x)) - left + 44,
        height: Math.max(...hop.map((entry) => entry.y)) - top + 62,
      },
    };
  }
  const count = Math.max(1, targetIds.length);
  const step =
    count <= 2 ? Math.max(56, Math.min(84, availableHeight - 56)) : 84;
  const middle = Math.max(56, 23 + ((count - 1) * step) / 2);
  const childY = (index: number) => middle + (index - (count - 1) / 2) * step;
  const offset = parent ? 0 : -76;
  const scenes: MapScene[] = [
    { node: current, kind: "current", x: 108 + offset, y: middle - 56 },
  ];
  if (parent)
    scenes.push({ node: parent, kind: "parent", x: 12, y: middle - 20 });
  targetIds.forEach((id, index) =>
    scenes.push({
      node: byId.get(id)!,
      kind: "child",
      x: 284 + offset,
      y: childY(index) - 23,
    }),
  );
  const edges: MapEdge[] = [];
  if (parent)
    edges.push({
      path: `M40 ${middle}H108`,
      x: 40,
      y: middle - 8,
      label: current.reachedBy[0]?.label ?? "",
    });
  const choices: MapChoice[] = [];
  const groups = new Map<string, typeof current.routes>();
  for (const route of current.routes.filter((route) =>
    targetIds.includes(route.target),
  ))
    groups.set(route.componentId, [
      ...(groups.get(route.componentId) ?? []),
      route,
    ]);
  for (const [id, routes] of groups) {
    const y =
      routes.reduce(
        (sum, route) => sum + childY(targetIds.indexOf(route.target)),
        0,
      ) / routes.length;
    choices.push({ id, x: 174 + offset, y: y - 10 });
    edges.push({
      path: elbow(152 + offset, middle, 174 + offset, y, 164 + offset),
      label: "",
      x: 0,
      y: 0,
    });
    for (const target of new Set(routes.map((route) => route.target))) {
      const targetY = childY(targetIds.indexOf(target));
      const options = routes.filter((route) => route.target === target);
      edges.push({
        path: elbow(194 + offset, y, 284 + offset, targetY, 211 + offset),
        label: options.map((route) => route.label).join(" / "),
        x: 218 + offset,
        y: targetY - 8,
      });
    }
  }
  for (const id of targetIds.filter(
    (id) => !current.routes.some((route) => route.target === id),
  )) {
    const y = childY(targetIds.indexOf(id));
    edges.push({
      path: elbow(152 + offset, middle, 284 + offset, y, 211 + offset),
      label: "",
      x: 0,
      y: 0,
    });
  }
  // Compact a two-child hop to the available height; larger hops can pan.
  return {
    scenes,
    choices,
    edges,
    width: 390 + offset,
    height: Math.max(112, (count - 1) * step + 56),
    ...(count === 1 && !targetIds.length
      ? { ghost: { x: 208 + offset, y: middle - 23 } }
      : {}),
  };
}
