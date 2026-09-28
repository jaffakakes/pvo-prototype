import type { Outcome, Scene } from "../../../domain/project/model";
import { fmt } from "../../../ui/formatTime";

export function outcomeName(outcome: Outcome | undefined, scenes: Scene[]) {
  if (!outcome || outcome.kind === "continue")
    return "Continue";
  if (outcome.kind === "time")
    return `→ ${fmt(outcome.t)}`;
  if (outcome.kind === "request")
    return "Request";
  return `→ ${scenes.find(scene => scene.id === outcome.sceneId)?.name ?? "Scene"}`;
}
