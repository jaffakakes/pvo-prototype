import { HttpError } from "../http.js";
import { withAssistantDeadline } from "./deadline.js";
import { assistantMessages, repairMessages } from "./prompt.js";
import { AssistantPolicyError, compileAssistantOriginal, validateAssistantProposal } from "./policy.js";

/** Coordinate bounded inference and compiler review without storing project source or executing proposals. */
export function proposeAssistantChange(request, { compile, reserve, run, signal, attemptMs = 25000, totalMs = 50000 }) {
  return withAssistantDeadline(async operationSignal => {
    let original;
    try {
      original = await compileAssistantOriginal(request, compile);
    } catch (error) {
      if (error instanceof AssistantPolicyError)
        throw new HttpError(400, "Correct the component's PVO source before asking for a proposal.");
      throw new HttpError(503, "The assistant compiler is unavailable. Please try again later.");
    }
    let messages = assistantMessages(request);
    for (let attempt = 0; attempt < 2; attempt++) {
      operationSignal.throwIfAborted();
      await reserve();
      operationSignal.throwIfAborted();
      const draft = await withAssistantDeadline(attemptSignal => run(messages, attemptSignal), attemptMs, operationSignal);
      operationSignal.throwIfAborted();
      try {
        await validateAssistantProposal(request, original, draft, compile);
        operationSignal.throwIfAborted();
        return draft;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (!(error instanceof AssistantPolicyError))
          throw new HttpError(503, "The assistant compiler is unavailable. Please try again later.");
        if (error.code === "advanced_required")
          throw new HttpError(409, "Enable Advanced for this logic change.");
        if (attempt === 1)
          throw new HttpError(422, "The assistant could not produce a valid proposal. Please try a clearer request.");
        messages = repairMessages(messages, draft, error);
      }
    }
  }, totalMs, signal);
}
