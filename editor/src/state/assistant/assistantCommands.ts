import { validateAssistantContext } from "../../domain/assistant/context";
import { matchesAssistantTarget, type AssistantReview } from "../../domain/assistant/review";
import { total } from "../../domain/clips/timing";
import { collectRequestDomains } from "../../domain/components/actions";
import { useCapture } from "../captureStore";
import { useEditorPreferences } from "../preferences/editorPreferences";
import { validateAssistantEditingMode } from "../../domain/assistant/editingMode";

/** The only assistant operation that writes the project or its history. */
export function keepAssistantReview(review: AssistantReview): boolean {
  const current = useCapture.getState();
  if (current.currentSceneId !== review.original.sceneId || current.selComp !== review.original.id
    || !matchesAssistantTarget(review.original, current.components.find(component => component.id === review.original.id))) return false;
  validateAssistantContext(review.proposal.compiled, {
    sceneIds: current.scenes.filter(scene => scene.clips.length).map(scene => scene.id), duration: total(current.clips),
    requestDomains: collectRequestDomains(current.scenes, current.allowedDomains),
  });
  validateAssistantEditingMode(review, useEditorPreferences.getState().advancedEditingEnabled);
  current.updateComponent(review.original.id, {
    fields: review.proposed.fields, look: review.proposed.look, code: review.proposed.code,
  });
  return true;
}
