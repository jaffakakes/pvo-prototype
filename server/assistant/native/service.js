import { parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { HttpError } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { nativeCompletionMessages, nativeMessages, nativeRepairMessages } from "./prompt.js";
import { validateNativeResult } from "./policy.js";
import { inspectNativeFrames, nativeFrameEvidence } from "./vision.js";
import { NativeAssistantError } from "./errors.js";
import { nativeGenerationSchema } from "./generationSchema.js";
import { createNativeValidationTrace } from "./validationDiagnostics.js";

/** Review a terminal answer once, sharing one schema repair across both stages. */
export function nativeAssistantTurn(request, {
  models, signal, totalMs = 90000, attemptMs = models.textAttemptMs, compile,
  wordTiming = false, animation = false, objectTracking = false,
  trace = createNativeValidationTrace(),
}) {
  return withAssistantDeadline(async operationSignal => {
    const observations = await inspectNativeFrames(request, { models, signal: operationSignal });
    const evidence = nativeFrameEvidence(observations);
    const contextMessages = nativeMessages(request, observations, { wordTiming, animation, objectTracking });
    const schema = nativeGenerationSchema({ mode: request.mode, wordTiming, animation, objectTracking });
    let messages = contextMessages;
    let reviewed = false;
    let repaired = false;
    let phase = "initial";
    for (let attempt = 0; attempt < 3; attempt++) {
      operationSignal.throwIfAborted();
      let result;
      try {
        result = await withAssistantDeadline(attemptSignal => models.generate({
          messages, schema, temperature: 0.15, maxTokens: 3000,
        }, attemptSignal), attemptMs, operationSignal);
      } catch (error) {
        operationSignal.throwIfAborted();
        trace({ stage: "decode", phase, attempt: attempt + 1, error });
        throw error;
      }
      let response = result?.content;
      let failureCode = "model_output_invalid";
      let stage = "decode";
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
        stage = "schema";
        const parsed = parseNativeTurnResult(response);
        failureCode = "edit_validation_failed";
        stage = "policy";
        if (!animation && parsed.operations.some(item => item.kind.startsWith("animation.")))
          throw new Error("Layer animation is unavailable in this editor session. Use only available operations.");
        if ((!objectTracking || !animation) && (parsed.observations.some(item => item.kind === "object_tracking")
          || parsed.operations.some(item => item.kind === "animation.follow")))
          throw new Error("Object tracking is unavailable in this editor session. Use only available operations.");
        if (!wordTiming && parsed.observations.some(item => item.kind === "word_timing"))
          throw new Error("Word timing is unavailable on this server. Use the available observations.");
        await validateNativeResult(request, parsed, compile);
        operationSignal.throwIfAborted();
        if (phase !== "initial")
          trace({ stage: phase, status: "completed", phase, attempt: attempt + 1, response: parsed, finishReason: result.finishReason });
        if (!reviewed && !parsed.operations.length && !parsed.observations.length) {
          reviewed = true;
          phase = "review";
          trace({ stage: "review", status: "started", phase, attempt: attempt + 1, response: parsed, finishReason: result.finishReason });
          messages = nativeCompletionMessages(contextMessages, parsed, request);
          continue;
        }
        return parseNativeTurnResult({ ...parsed, ...(evidence.length ? { evidence } : {}) });
      } catch (error) {
        operationSignal.throwIfAborted();
        trace({ stage, phase, attempt: attempt + 1, error, response, finishReason: result?.finishReason, failureCode });
        if (error instanceof HttpError) throw error;
        if (repaired)
          throw new NativeAssistantError(failureCode);
        repaired = true;
        phase = "repair";
        trace({ stage: "repair", status: "started", phase, attempt: attempt + 1 });
        messages = nativeRepairMessages(messages, response ?? null, error, request);
      }
    }
    throw new NativeAssistantError("edit_validation_failed");
  }, totalMs, signal);
}
