import { HttpError } from "../../http.js";
import { requestRunpodJson } from "./runpodHttp.js";
import { NativeAssistantError } from "./errors.js";

export const RUNPOD_NATIVE_MODEL = "kimi-k2.6";
export const RUNPOD_AUTHORING_MODEL = "kimi-k3";
const ENDPOINT_PATH = "/v2/moonshot-kimi/openai/v1/chat/completions";
const invalidResponse = () => new NativeAssistantError("model_output_invalid");

/** Runpod-specific OpenAI wire adapter. Only final content reaches the native loop. */
export function runpodNativeModels(
  apiKey,
  { fetch: send = globalThis.fetch } = {},
) {
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw new HttpError(503, "The assistant model is not configured.");
  const complete = async (payload, signal, authoring = false) => {
    const result = await requestRunpodJson(
      ENDPOINT_PATH,
      {
        stream: false,
        ...payload,
        ...(authoring
          ? {
              model: RUNPOD_AUTHORING_MODEL,
              reasoning_effort: "high",
              temperature: 1,
            }
          : {
              model: RUNPOD_NATIVE_MODEL,
              thinking: { type: "disabled" },
              temperature: 0.6,
            }),
      },
      apiKey,
      signal,
      { fetch: send },
    );
    signal.throwIfAborted();
    const choice = result?.choices?.[0];
    if (choice?.finish_reason === "length")
      throw new NativeAssistantError("model_output_truncated");
    if (
      !Array.isArray(result?.choices) ||
      result.choices.length !== 1 ||
      choice?.finish_reason !== "stop" ||
      choice.message?.role !== "assistant" ||
      typeof choice.message.content !== "string" ||
      !choice.message.content.trim() ||
      choice.message.refusal ||
      (choice.message.tool_calls !== undefined &&
        (!Array.isArray(choice.message.tool_calls) ||
          choice.message.tool_calls.length))
    ) {
      throw invalidResponse();
    }
    return choice.message.content;
  };
  return {
    textAttemptMs: 60000,
    frameAttemptMs: 60000,
    generate: async ({ messages, schema, maxTokens, purpose }, signal) => ({
      // The endpoint does not enforce these union schemas. Local validation
      // remains authoritative for both the native editor and saved authoring.
      content: await complete(
        {
          messages: [
            {
              role: "system",
              content: `Return only a JSON object matching this schema: ${JSON.stringify(schema)}`,
            },
            ...messages,
          ],
          // Saved authoring reserves room for reasoning as well as final JSON.
          max_tokens:
            purpose === "saved_authoring"
              ? Math.max(32768, maxTokens)
              : maxTokens,
          response_format: { type: "json_object" },
        },
        signal,
        purpose === "saved_authoring",
      ),
    }),
    describeFrame: ({ question, image }, signal) =>
      complete(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: question },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          max_tokens: 350,
        },
        signal,
      ),
  };
}
