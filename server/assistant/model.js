import { assistantResponseSchema, parseAssistantResponse } from "../../packages/pvo-assistant/index.js";
import { HttpError } from "../http.js";

export const ASSISTANT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function providerFailure(error, ai) {
  const status = error?.status ?? error?.statusCode ?? ai.lastRequestHttpStatusCode;
  const code = error?.internalCode ?? error?.code ?? ai.lastRequestInternalStatusCode;
  const name = ["InferenceUpstreamError", "AiInternalError", "AbortError", "TypeError", "Error"].includes(error?.name)
    ? error.name : "ProviderError";
  const details = {
    model: ASSISTANT_MODEL,
    name,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    code: Number.isSafeInteger(code) && code >= 0 ? code : null,
  };
  // Binding status/code are diagnostic metadata; never log its exception message or request contents.
  console.warn(JSON.stringify(details));
  return details;
}

/** Workers AI JSON mode can return its response as either a JSON object or a JSON string. */
export async function runAssistantModel(ai, messages, signal) {
  let result;
  try {
    result = await ai.run(ASSISTANT_MODEL, {
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: "json_schema", json_schema: assistantResponseSchema },
    }, { signal });
  } catch (error) {
    signal.throwIfAborted();
    const failure = providerFailure(error, ai);
    if (failure.status === 429 || failure.code === 3036)
      throw new HttpError(429, "The assistant is busy. Please try again later.");
    throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  }
  signal.throwIfAborted();
  try {
    if (!result || typeof result !== "object" || Array.isArray(result)
      || (result.tool_calls !== undefined && (!Array.isArray(result.tool_calls) || result.tool_calls.length)))
      throw new TypeError("Unsupported model response.");
    let response = result.response;
    if (typeof response === "string") {
      if (new TextEncoder().encode(response).byteLength > 96 * 1024) throw new TypeError("Response too large.");
      response = JSON.parse(response);
    }
    return parseAssistantResponse(response);
  } catch {
    throw new HttpError(422, "The assistant could not produce a valid proposal. Please try a clearer request.");
  }
}
