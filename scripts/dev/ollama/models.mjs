import { HttpError } from "../../../server/http.js";
import { NativeAssistantError } from "../../../server/assistant/native/errors.js";
import { localEditingMessages } from "./prompt.mjs";

const origin = "http://127.0.0.1:11434";

/** Local inference has one fixed loopback target and never selects a cloud model. */
export function localOllamaModels(model, { fetcher = fetch, request } = {}) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/.test(model) ||
    /cloud/i.test(model)
  )
    throw new Error("Choose a downloaded local Ollama model.");

  const read = async (path, options, signal) => {
    signal.throwIfAborted();
    const response = await fetcher(`${origin}${path}`, {
      ...options,
      signal,
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      await response.body?.cancel();
      throw new HttpError(503, "The local Ollama model is unavailable.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024)
          throw new Error("Ollama response exceeded its limit.");
        chunks.push(value);
      }
      signal.throwIfAborted();
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };

  const complete = async (
    messages,
    { schema, maxTokens, temperature },
    signal,
  ) => {
    const result = await read(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          think: false,
          ...(schema ? { format: schema } : {}),
          keep_alive: "15m",
          // Qwen's prose repetition defaults fight repeated JSON keys. Keep
          // structured editor commands deterministic without those penalties.
          options: {
            num_ctx: 16384,
            num_predict: maxTokens,
            temperature: schema ? 0 : temperature,
            ...(schema ? { presence_penalty: 0, repeat_penalty: 1 } : {}),
          },
        }),
      },
      signal,
    );
    if (result.done_reason === "length")
      throw new NativeAssistantError("model_output_truncated");
    if (
      !result.done ||
      result.message?.role !== "assistant" ||
      typeof result.message.content !== "string" ||
      !result.message.content.trim() ||
      result.message.tool_calls?.length
    )
      throw new NativeAssistantError("model_output_invalid");
    return result.message.content;
  };

  return {
    textAttemptMs: 60000,
    frameAttemptMs: 60000,
    available: async (signal) => {
      try {
        const result = await read(
          "/api/tags",
          { method: "GET" },
          AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        );
        return result.models?.some((item) => item.name === model) === true;
      } catch {
        signal.throwIfAborted();
        return false;
      }
    },
    generate: async ({ messages, schema, maxTokens, temperature }, signal) => ({
      content: await complete(
        localEditingMessages(messages, request),
        { schema, maxTokens, temperature },
        signal,
      ),
    }),
    describeFrame: ({ question, image }, signal) => {
      const match =
        /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!match) throw new HttpError(400, "Send a supported image frame.");
      return complete(
        [{ role: "user", content: question, images: [match[1]] }],
        { maxTokens: 350, temperature: 0.1 },
        signal,
      );
    },
  };
}
