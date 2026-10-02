import type { AnimationTarget } from "../../../domain/animation/model";
import type { AnimationGroup } from "../../../domain/animation/authoring";

/** One visible authoring lane; both timeline headers and wells use this list. */
export type AnimationLane = {
  target: AnimationTarget;
  groups: AnimationGroup[];
  single: boolean;
};

export function sameAnimationTarget(
  left: AnimationTarget,
  right: AnimationTarget,
) {
  return (
    left.kind === right.kind &&
    ("id" in left ? "id" in right && left.id === right.id : true)
  );
}
