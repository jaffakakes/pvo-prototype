import { fieldsShownFor } from "../../domain/components/fields";
import { isCodeOwned } from "../../domain/components/codeOwnership";
import { toVisualFormFields } from "../../domain/components/forms";
import { editComponentAction } from "../../domain/components/languageActionEditing";
import type { OutcomeTarget, PlaybackOutcome } from "../../domain/project/model";
import { useCapture } from "../captureStore";

/** Creates and connects a branch atomically; the caller chooses how to add its media. */
export function createRoutedScene(componentId: string, target: OutcomeTarget, branch?: "success" | "error", options?: {
  openCamera?: boolean;
}): string | null {
  const state = useCapture.getState();
  const source = state.scenes.find(scene => scene.components.some(component => component.id === componentId));
  const component = source?.components.find(item => item.id === componentId);
  if (!source || !component || source.id !== state.currentSceneId) return null;
  if (target.kind !== "form" && (target.index === undefined || !Number.isInteger(target.index) || target.index < 0)) return null;
  const fields = fieldsShownFor(component);
  const control = target.kind === "option" ? fields.options?.[target.index ?? 0]
    : target.kind === "button" ? fields.buttons?.[target.index ?? 0] : null;
  if (target.kind !== "form" && !control) return null;
  const selected = target.kind === "form" ? fields.outcome : control?.outcome;
  const visualFormBranch = target.kind === "form" && branch && !isCodeOwned(component) && selected?.kind !== "request";
  if (!visualFormBranch) {
    if (branch === "error" && selected?.kind !== "request") return null;
    // Validate the source edit before creating a scene or changing the selection.
    // The new scene ID changes only the route value, not its editable event target.
    const proposed: PlaybackOutcome = { kind: "scene", sceneId: "pending-scene" };
    const outcome = branch && selected?.kind === "request" ? {
      ...selected, ...(branch === "success" ? { onSuccess: proposed } : { onError: proposed }),
    } : proposed;
    if (!editComponentAction(component, fields, target, outcome)) return null;
  }
  const id = state.createScene();
  const route: PlaybackOutcome = { kind: "scene", sceneId: id };
  if (visualFormBranch) {
    state.updateComponent(component.id, { fields: {
      ...toVisualFormFields(fields), ...(branch === "success" ? { successOutcome: route } : { failureOutcome: route }),
    } }, false);
  } else if (branch && selected?.kind === "request") {
    state.updateOutcome(component.id, target, {
      ...selected, ...(branch === "success" ? { onSuccess: route } : { onError: route }),
    }, false);
  } else {
    state.updateOutcome(component.id, target, route, false);
  }
  if (options?.openCamera !== false) state.startRecordingIntoScene(id);
  return id;
}
