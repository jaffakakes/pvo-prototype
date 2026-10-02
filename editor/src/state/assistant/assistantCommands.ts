import { validateAssistantContext } from "../../domain/assistant/context";
import { matchesAssistantTarget, type AssistantReview } from "../../domain/assistant/review";
import { collectRequestDomains } from "../../domain/components/actions";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../captureStore";
import { useEditorPreferences } from "../preferences/editorPreferences";
import { validateAssistantEditingMode } from "../../domain/assistant/editingMode";

/** Commits an unkept proposal through normal component history. */
export function keepAssistantReview(review: AssistantReview): boolean {
  const current = useCapture.getState();
  if (current.currentSceneId !== review.original.sceneId || current.selComp !== review.original.id
    || !matchesAssistantTarget(review.original, current.components.find(component => component.id === review.original.id))) return false;
  validateAssistantContext(review.proposal.compiled, {
    sceneIds: current.scenes.filter(scene => scene.clips.length).map(scene => scene.id), duration: sceneDuration(current),
    requestDomains: collectRequestDomains(current.scenes, current.allowedDomains),
  });
  validateAssistantEditingMode(review, useEditorPreferences.getState().advancedEditingEnabled);
  current.updateComponent(review.original.id, {
    fields: review.proposed.fields, look: review.proposed.look, code: review.proposed.code,
  });
  return true;
}
