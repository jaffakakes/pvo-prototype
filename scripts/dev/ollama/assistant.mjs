import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { nativeAssistantTurn } from "../../../server/assistant/native/service.js";
import { validateNativeInput } from "../../../server/assistant/native/policy.js";
import { NativeAssistantError } from "../../../server/assistant/native/errors.js";
import { HttpError } from "../../../server/http.js";
import { compileLocalComponent } from "./compiler.mjs";
import { localOllamaModels } from "./models.mjs";

/** Replace inference locally; public web/font tools keep their existing HTTP adapter. */
export function createOllamaAssistantFetch({
  model = "qwen3.5:9b",
  fetcher = fetch,
  compile = compileLocalComponent,
} = {}) {
  const models = localOllamaModels(model, { fetcher });
  let active = false;
  return async (url, options) => {
    const path = new URL(url).pathname;
    if (!path.startsWith("/api/assistant/")) return fetcher(url, options);
    const signal = options.signal;
    try {
      if (path === "/api/assistant/status") {
        const available = await models.available(signal);
        return Response.json({
          provider: "open-source",
          available,
          model,
          capabilities: {
            editing: available,
            frames: available,
            transcription: false,
            wordTiming: false,
            objectTracking: false,
          },
          chatgpt: {
            available: false,
            reason: "hosted_access_required",
            message: "This beta uses local Ollama inference.",
            documentationUrl:
              "https://developers.openai.com/siwc/token-sharing-open-source",
          },
        });
      }
      if (path !== "/api/assistant/turn")
        throw new HttpError(
          503,
          "This capability is not configured for local Ollama.",
        );
      if (active)
        throw new HttpError(
          429,
          "The local model is busy. Please try again shortly.",
        );
      let input;
      try {
        input = parseNativeTurnRequest(JSON.parse(options.body.toString()));
        validateNativeInput(input);
      } catch {
        throw new HttpError(
          400,
          "Send a valid project context and assistant request.",
        );
      }
      active = true;
      try {
        return Response.json(
          await nativeAssistantTurn(input, {
            models: localOllamaModels(model, { fetcher, request: input }),
            signal,
            compile,
            animation: options.headers["x-assistant-animation"] === "1",
          }),
        );
      } finally {
        active = false;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof NativeAssistantError)
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      if (error instanceof HttpError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      return Response.json(
        { error: "The local Ollama model could not finish this request." },
        { status: 503 },
      );
    }
  };
}
