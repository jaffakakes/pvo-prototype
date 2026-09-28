import {
  AssistantPolicyError,
  validateCompiledAssistantOriginal,
  validateCompiledAssistantProposal,
} from "../../packages/pvo-assistant/policy.js";
import { validateNoCodeAssistantProposal } from "../../packages/pvo-assistant/no-code-policy.js";

export { AssistantPolicyError } from "../../packages/pvo-assistant/policy.js";

async function compileSource(kind, source, compile) {
  try {
    return await compile(kind, source);
  } catch (error) {
    if (error?.name !== "PvoLanguageError") throw error;
    throw new AssistantPolicyError("invalid_source", error.message, {
      part: error.part, diagnostic: error.diagnostic,
    });
  }
}

/** Reject invalid authoring input before consuming model capacity. */
export async function compileAssistantOriginal(request, compile) {
  const original = await compileSource(request.componentType, request.source, compile);
  validateCompiledAssistantOriginal(original, request.context);
  return original;
}

/** Compile the exact returned source; no dropped declarations or repaired actions. */
export async function validateAssistantProposal(request, original, draft, compile) {
  if (draft.requiresAdvancedLogic)
    throw new AssistantPolicyError("advanced_required", "Enable Advanced for this logic change.");
  const proposed = await compileSource(request.componentType, draft.source, compile);
  if (request.editingMode !== "advanced")
    validateNoCodeAssistantProposal(original, proposed);
  validateCompiledAssistantProposal(original, proposed, request.context);
  return proposed;
}
