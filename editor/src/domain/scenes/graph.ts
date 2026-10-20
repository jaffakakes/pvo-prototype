import type { Outcome, Scene } from "../project/model";
import { fieldsShownFor } from "../components/fields";
import { sceneDuration } from "./duration";
import { sceneTree } from "./rules";

export type SceneRoute = {
  componentId: string;
  optionIndex: number;
  label: string;
  target: string;
};
export type SceneNode = {
  scene: Scene;
  depth: number;
  duration: number;
  children: string[];
  reachedBy: SceneRoute[];
  routes: SceneRoute[];
};

function destinations(outcome: Outcome): string[] {
  if (outcome.kind === "scene") return [outcome.sceneId];
  if (outcome.kind === "request")
    return [
      ...new Set([
        ...destinations(outcome.onSuccess),
        ...(outcome.onError ? destinations(outcome.onError) : []),
      ]),
    ];
  return [];
}

/** Both views describe authored choice routes, without inventing links from ancestry. */
export function sceneGraph(scenes: readonly Scene[]): SceneNode[] {
  const nodes = sceneTree(scenes).map(({ scene, depth }) => ({
    scene,
    depth,
    duration: sceneDuration(scene),
    children: scenes
      .filter((child) => child.parent === scene.id)
      .map((child) => child.id),
    reachedBy: [] as SceneRoute[],
    routes: scene.components
      .filter((component) => component.type === "choice")
      .flatMap((component) =>
        (fieldsShownFor(component).options ?? []).flatMap(
          (option, optionIndex) =>
            destinations(option.outcome).map((target) => ({
              componentId: component.id,
              optionIndex,
              label: option.label,
              target,
            })),
        ),
      ),
  }));
  const byId = new Map(nodes.map((node) => [node.scene.id, node]));
  for (const node of nodes)
    node.reachedBy =
      byId
        .get(node.scene.parent ?? "")
        ?.routes.filter((route) => route.target === node.scene.id) ?? [];
  return nodes;
}
