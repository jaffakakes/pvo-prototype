import { compilePvoComponent } from "../../../../packages/pvo-language/index.js";
import { AssistantPolicyError, validateCompiledAssistantOriginal, validateCompiledAssistantProposal } from "../../../../packages/pvo-assistant/policy.js";
import { validateNoCodeAssistantProposal } from "../../../../packages/pvo-assistant/no-code-policy.js";
import type { AssistantMode, AssistantProposal, AssistantRequest } from "../../domain/assistant/model";
import { validateAssistantDraft, validateAssistantRequest } from "../../domain/assistant/validation";
import { createHttpProvider } from "./httpProvider";
import { preparePvoFormatting } from "../language/formatSource";

type Options = {
  endpoint?: string;
  fetch?: typeof fetch;
  compile?: typeof compilePvoComponent;
};

export type AssistantService = {
  mode: AssistantMode;
  label: string;
  propose(request: AssistantRequest, options?: { signal?: AbortSignal }): Promise<AssistantProposal>;
};

/** Proposals stay separate from editor state; callers decide whether and when to apply. */
export function createAssistantService(options: Options = {}): AssistantService {
  const configured = options.endpoint ?? import.meta.env?.VITE_PVO_ASSISTANT_URL;
  const endpoint = (typeof configured === "string" ? configured.trim() : "") || "/api/assistant";
  const mode: AssistantMode = "connected";
  const label = "PVO assistant";
  const provider = createHttpProvider(endpoint, options.fetch);
  const compile = options.compile ?? compilePvoComponent;

  return {
    mode,
    label,
    async propose(input, { signal } = {}) {
      signal?.throwIfAborted();
      const request = validateAssistantRequest(input);
      const original = await compile(request.componentType, request.source);
      signal?.throwIfAborted();
      validateCompiledAssistantOriginal(original, request.context);
      const raw = await provider(request, signal);
      signal?.throwIfAborted();
      const draft = validateAssistantDraft(raw);
      if (draft.requiresAdvancedLogic)
        throw new AssistantPolicyError("advanced_required", "Enable Advanced for this logic change.");
      const compiled = await compile(request.componentType, draft.source);
      signal?.throwIfAborted();
      if (request.editingMode !== "advanced")
        validateNoCodeAssistantProposal(original, compiled);
      validateCompiledAssistantProposal(original, compiled, request.context);
      const formatted = await preparePvoFormatting(request.componentType, draft.source, compile, compiled);
      signal?.throwIfAborted();
      return { ...draft, source: formatted?.source ?? draft.source, mode, label,
        compiled: { structure: compiled.structure, rules: compiled.rules } };
    },
  };
}
