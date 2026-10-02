import { parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { HttpError } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { nativeCompletionMessages, nativeMessages, nativeRepairMessages } from "./prompt.js";
import { validateNativeResult } from "./policy.js";
import { inspectNativeFrames, nativeFrameEvidence } from "./vision.js";

// Keep the grammar small while making observation, editing and terminal output
// mutually exclusive. The canonical parser still validates every operation.
const messageSchema = { type: "string", maxLength: 8000 };
const emptyItems = { type: "array", maxItems: 0, items: { type: "object" } };
const envelope = properties => ({
  type: "object", additionalProperties: false, required: ["message", "operations", "observations"],
  properties: { message: messageSchema, ...properties },
});
const modelEnvelopeSchema = { anyOf: [
  envelope({
    operations: { type: "array", minItems: 1, maxItems: 24, items: { type: "object" } },
    observations: emptyItems,
  }),
  envelope({
    operations: emptyItems,
    observations: { type: "array", minItems: 1, maxItems: 4, items: { type: "object" } },
  }),
  envelope({
    operations: emptyItems, observations: emptyItems,
    blocked: { type: "boolean", const: true },
    answer: { type: "string", minLength: 1, maxLength: 8000 },
  }),
] };

/** Review a terminal answer once, sharing one schema repair across both stages. */
export function nativeAssistantTurn(request, { models, signal, totalMs = 90000, attemptMs = models.textAttemptMs, compile, wordTiming = false, animation = false, objectTracking = false }) {
  return withAssistantDeadline(async operationSignal => {
    const observations = await inspectNativeFrames(request, { models, signal: operationSignal });
    const evidence = nativeFrameEvidence(observations);
    const contextMessages = nativeMessages(request, observations, { wordTiming, animation, objectTracking });
    let messages = contextMessages;
    let reviewed = false;
    let repaired = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      operationSignal.throwIfAborted();
      const result = await withAssistantDeadline(attemptSignal => models.generate({ messages, schema: modelEnvelopeSchema, temperature: 0.15, maxTokens: 3000 }, attemptSignal), attemptMs, operationSignal);
      let response = result?.content;
      try {
        if (!result || typeof result !== "object" || Array.isArray(result)
          || (result.toolCalls !== undefined && (!Array.isArray(result.toolCalls) || result.toolCalls.length)))
          throw new Error("Return the native editor JSON result, without separate tool calls.");
        if (typeof response === "string") {
          if (response.length > 64000) throw new Error("The response is too large.");
          response = JSON.parse(response);
        }
        if (new TextEncoder().encode(JSON.stringify(response)).byteLength > 64 * 1024)
          throw new Error("The response is too large.");
        if (response && typeof response === "object" && Object.hasOwn(response, "evidence"))
          throw new Error("Evidence is added by the server. Return only message, operations, observations and the optional blocked or answer fields.");
        const parsed = parseNativeTurnResult(response);
        if (!animation && parsed.operations.some(item => item.kind.startsWith("animation.")))
          throw new Error("Layer animation is unavailable in this editor session. Use only available operations.");
        if ((!objectTracking || !animation) && (parsed.observations.some(item => item.kind === "object_tracking")
          || parsed.operations.some(item => item.kind === "animation.follow")))
          throw new Error("Object tracking is unavailable in this editor session. Use only available operations.");
        if (!wordTiming && parsed.observations.some(item => item.kind === "word_timing"))
          throw new Error("Word timing is unavailable on this server. Use the available observations.");
        await validateNativeResult(request, parsed, compile);
        operationSignal.throwIfAborted();
        if (!reviewed && !parsed.operations.length && !parsed.observations.length) {
          reviewed = true;
          messages = nativeCompletionMessages(contextMessages, parsed, request);
          continue;
        }
        return parseNativeTurnResult({ ...parsed, ...(evidence.length ? { evidence } : {}) });
      } catch (error) {
        operationSignal.throwIfAborted();
        if (error instanceof HttpError) throw error;
        if (repaired)
          throw new HttpError(422, "The assistant could not produce valid editor actions. Try a more specific request.");
        repaired = true;
        messages = nativeRepairMessages(messages, response ?? null, error, request);
      }
    }
    throw new HttpError(422, "The assistant could not produce valid editor actions. Try a more specific request.");
  }, totalMs, signal);
}
