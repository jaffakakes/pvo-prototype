import { HttpError } from "../../http.js";
import { requestRunpodJson } from "./runpodHttp.js";
import { NativeAssistantError } from "./errors.js";

export const RUNPOD_NATIVE_MODEL = "kimi-k2.6";
const ENDPOINT_PATH = "/v2/moonshot-kimi/openai/v1/chat/completions";
const invalidResponse = () => new NativeAssistantError("model_output_invalid");

/** Runpod-specific OpenAI wire adapter. Only final content reaches the native loop. */
export function runpodNativeModels(apiKey, { fetch: send = globalThis.fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new HttpError(503, "The assistant model is not configured.");
  const complete = async (payload, signal) => {
    const result = await requestRunpodJson(ENDPOINT_PATH,
      { model: RUNPOD_NATIVE_MODEL, stream: false, ...payload, thinking: { type: "disabled" }, temperature: 0.6 },
      apiKey, signal, { fetch: send });
    signal.throwIfAborted();
    const choice = result?.choices?.[0];
    if (choice?.finish_reason === "length") throw new NativeAssistantError("model_output_truncated");
    if (!Array.isArray(result?.choices) || result.choices.length !== 1 || choice?.finish_reason !== "stop"
      || choice.message?.role !== "assistant" || typeof choice.message.content !== "string"
      || !choice.message.content.trim() || choice.message.refusal
      || (choice.message.tool_calls !== undefined && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length))) {
      throw invalidResponse();
    }
    return choice.message.content;
  };
  return {
    textAttemptMs: 60000,
    frameAttemptMs: 60000,
    generate: async ({ messages, schema, maxTokens }, signal) => ({
      content: await complete({ messages, max_tokens: maxTokens,
        response_format: { type: "json_schema", json_schema: { name: "native_editor_turn", strict: false, schema } },
      }, signal),
    }),
    describeFrame: ({ question, image }, signal) => complete({
      messages: [{ role: "user", content: [
        { type: "text", text: question }, { type: "image_url", image_url: { url: image } },
      ] }], max_tokens: 350,
    }, signal),
  };
}
