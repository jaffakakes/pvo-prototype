import { HttpError } from "../../http.js";

export const NATIVE_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const NATIVE_VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
export const NATIVE_TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** A fixed public classification; raw provider diagnostics never enter the UI. */
export class NativeProviderAllowanceError extends HttpError {
  constructor() {
    super(429, "The AI provider's daily allowance is exhausted. Try after it resets.");
    this.code = "provider_allowance_exhausted";
  }
}

function allowanceExhausted(error, code) {
  if (code === 3036) return true;
  // Workers AI sometimes reports this specific daily allowance failure as 4006,
  // which otherwise has broader failure meanings. Do not classify every 4006.
  return code === 4006 && typeof error?.message === "string"
    && /^(?:4006:\s*)?you have used up your daily free allocation of [\d,]+ neurons(?:,|\.|$)/i.test(error.message);
}

/** Keep provider diagnostics separate from private prompts, media and exception messages. */
export async function runNativeModel(ai, model, input, signal) {
  signal.throwIfAborted();
  try {
    const result = await ai.run(model, input, { signal });
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    const status = error?.status ?? error?.statusCode ?? ai.lastRequestHttpStatusCode;
    const prefix = typeof error?.message === "string" ? /^(\d{3,6}):/.exec(error.message) : null;
    const code = error?.internalCode ?? error?.code ?? ai.lastRequestInternalStatusCode ?? (prefix ? Number(prefix[1]) : null);
    console.warn(JSON.stringify({
      operation: "native-assistant", model,
      status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      code: Number.isSafeInteger(code) && code >= 0 ? code : null,
    }));
    if (allowanceExhausted(error, code)) throw new NativeProviderAllowanceError();
    if (status === 429)
      throw new HttpError(429, "The assistant is busy. Please try again later.");
    throw new HttpError(503, "The assistant model is unavailable. Please try again later.");
  }
}

/** Normalize the binding's model-specific payloads behind native capabilities. */
export function cloudflareNativeModels(ai) {
  return {
    textAttemptMs: 25000,
    frameAttemptMs: 20000,
    generate: async ({ messages, schema, maxTokens, temperature }, signal) => {
      const result = await runNativeModel(ai, NATIVE_TEXT_MODEL, {
        messages, stream: false, temperature, max_tokens: maxTokens,
        response_format: { type: "json_schema", json_schema: schema },
      }, signal);
      return { content: result?.response, toolCalls: result?.tool_calls };
    },
    describeFrame: async ({ question, image }, signal) => {
      const result = await runNativeModel(ai, NATIVE_VISION_MODEL, {
        task: "query", reasoning: false, question, image,
        stream: false, max_tokens: 350, temperature: 0.1,
      }, signal);
      return result?.result?.answer;
    },
  };
}
