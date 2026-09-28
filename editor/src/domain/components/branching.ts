import type { PvoComponent } from "../project/model";

export type BranchRoutes = { trueSceneId: string; falseSceneId: string };

/**
 * The format's end-of-layer branch (`scene_change`) needs one True and one False
 * route to two different scenes. A Restyle choice supplies them from its two options.
 */
export function branchRoutes(component: Pick<PvoComponent, "type" | "code" | "fields">): BranchRoutes | null {
  if (component.type !== "choice" || component.code?.custom) return null;
  const [first, second] = component.fields.options ?? [];
  if (first?.outcome.kind !== "scene" || second?.outcome.kind !== "scene") return null;
  if (first.outcome.sceneId === second.outcome.sceneId) return null;
  return { trueSceneId: first.outcome.sceneId, falseSceneId: second.outcome.sceneId };
}

/** Why the switch cannot apply, in the words the editor shows; null when the routes are valid. */
export function branchAtEndIssue(component: Pick<PvoComponent, "type" | "code" | "fields">): string | null {
  if (component.type !== "choice") return "Only a choice can branch when its layer ends.";
  if (component.code?.custom) return "Branch at layer end is not available for code-owned components. Route with an action in Advanced instead.";
  const [first, second] = component.fields.options ?? [];
  if (first?.outcome.kind !== "scene" || second?.outcome.kind !== "scene") return "Give both options a scene to go to.";
  if (first.outcome.sceneId === second.outcome.sceneId) return "The two options must go to different scenes.";
  return null;
}

/** True when the exported package will carry an end-of-layer branch for this component. */
export function branchesAtEnd(component: Pick<PvoComponent, "type" | "code" | "fields" | "branchAtEnd">): boolean {
  return !!component.branchAtEnd && branchRoutes(component) !== null;
}

type LegacyComponent = PvoComponent & { hold?: boolean };

/**
 * Projects saved before the documented model stored choices and forms as "hold"
 * components that froze the video at their start. They become ordinary timed
 * layers that show until their clip ends, and a choice keeps its stop-and-route
 * intent through the end-of-layer branch when its options already name two scenes.
 */
export function upgradeLegacyComponent(component: PvoComponent): PvoComponent {
  const legacy = component as LegacyComponent;
  if (legacy.hold === undefined) return component;
  const { hold, ...current } = legacy;
  return {
    ...current,
    dur: hold ? null : current.dur ?? null,
    ...(hold && branchRoutes(current) ? { branchAtEnd: true } : {}),
  };
}
