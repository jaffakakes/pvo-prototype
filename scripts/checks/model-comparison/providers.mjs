import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

export const candidates = Object.freeze({
  kimi: {
    model: "kimi-k2.7-code",
    inputRate: 0.95,
    cachedRate: 0.95,
    outputRate: 4,
    reasoning: "enabled",
  },
  sol: {
    model: "gpt-6.1-sol",
    inputRate: 2,
    cachedRate: 0.1,
    cacheWriteRate: 2.5,
    outputRate: 10,
    reasoning: "high",
  },
});

/** Price actual provider usage, including reasoning already counted in output tokens. Not an invoice. */
export function usageEstimate(candidate, usage) {
  if (!usage) return null;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  const cached =
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const cacheWrites =
    usage.input_tokens_details?.cache_write_tokens ??
    usage.prompt_tokens_details?.cache_write_tokens ??
    0;
  if (
    ![input, output, cached, cacheWrites].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    cached + cacheWrites > input
  )
    return null;
  return {
    input,
    output,
    cached,
    cacheWrites,
    reasoning:
      usage.output_tokens_details?.reasoning_tokens ??
      usage.completion_tokens_details?.reasoning_tokens ??
      null,
    estimatedUsd:
      ((input - cached - cacheWrites) * candidate.inputRate +
        cached * candidate.cachedRate +
        cacheWrites * (candidate.cacheWriteRate ?? candidate.inputRate) +
        output * candidate.outputRate) /
      1000000,
  };
}

export async function comparisonProvider(
  name,
  saveAttempt,
  { fetchImpl = fetch, apiKey = null } = {},
) {
  const candidate = candidates[name];
  if (!candidate) throw new Error("Unknown comparison candidate.");
  const privateRoot = homedir() + "/.codex/secure/";
  const key =
    apiKey ??
    (name === "sol"
      ? (
          await readFile(
            privateRoot + "restyle-model-comparison/openai.token",
            "utf8",
          )
        ).trim()
      : JSON.parse(
          await readFile(
            privateRoot + "restyle-beta-backend/worker-secrets.json",
            "utf8",
          ),
        ).RUNPOD_API_KEY);
  if (!key) throw new Error("The comparison credential is missing.");
  const endpoint =
    name === "sol"
      ? "https://api.openai.com/v1/responses"
      : "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions";
  let sequence = 0;
  return {
    candidate,
    async generate({ messages, schema }, signal) {
      const input = [
        {
          role: "system",
          content: `Return only a JSON object matching this schema: ${JSON.stringify(schema)}`,
        },
        ...messages,
      ];
      const request =
        name === "sol"
          ? {
              model: candidate.model,
              input,
              reasoning: { effort: "high" },
              max_output_tokens: 32768,
              text: { format: { type: "json_object" } },
              store: false,
              service_tier: "default",
            }
          : {
              model: candidate.model,
              messages: input,
              max_tokens: 32768,
              thinking: { type: "enabled" },
              temperature: 1,
              stream: false,
              response_format: { type: "json_object" },
            };
      const attempt = {
        sequence: ++sequence,
        requestedModel: candidate.model,
        reasoningSetting: candidate.reasoning,
        startedAt: new Date().toISOString(),
        promptDigest: createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex"),
        request,
      };
      await saveAttempt(attempt);
      const started = performance.now();
      let response, body;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal,
        });
        const parts = [];
        let size = 0;
        for await (const part of response.body) {
          size += part.length;
          if (size > 2 * 1024 * 1024)
            throw new Error("Provider reply exceeded its bound.");
          parts.push(part);
        }
        body = JSON.parse(Buffer.concat(parts).toString());
      } catch {
        attempt.elapsedMs = performance.now() - started;
        attempt.outcome = "transport_unknown";
        attempt.usage = null;
        await saveAttempt(attempt);
        throw new Error(
          "Provider request did not finish; its charge is unknown.",
        );
      }
      Object.assign(attempt, {
        elapsedMs: performance.now() - started,
        status: response.status,
        returnedModel: body.model ?? null,
        requestId: response.headers.get("x-request-id"),
        response: body,
        usage: usageEstimate(candidate, body.usage),
        outcome: response.ok ? "returned" : "provider_rejected",
      });
      await saveAttempt(attempt);
      if (!response.ok)
        throw new Error(
          `Comparison provider rejected the request (HTTP ${response.status}, ${body.error?.code ?? "unclassified"}).`,
        );
      // Never silently compare a substituted model.
      if (
        body.model !== candidate.model &&
        !body.model?.startsWith(candidate.model + "-")
      )
        throw new Error(
          "Provider returned a different model; this is not a valid comparison.",
        );
      if (name === "sol") {
        if (body.status !== "completed")
          throw new Error("Sol response did not complete.");
        const messages =
          body.output?.filter((item) => item.type === "message") ?? [];
        const content = messages
          .flatMap((item) => item.content ?? [])
          .filter((item) => item.type === "output_text")
          .map((item) => item.text)
          .join("");
        if (
          !content ||
          messages.some((item) =>
            item.content?.some((part) => part.type === "refusal"),
          )
        )
          throw new Error("Sol did not return a usable decision.");
        return { content };
      }
      const choice = body.choices?.[0];
      if (
        body.choices?.length !== 1 ||
        choice.finish_reason !== "stop" ||
        typeof choice.message?.content !== "string" ||
        choice.message.tool_calls?.length
      )
        throw new Error("Kimi did not return a complete decision.");
      return { content: choice.message.content };
    },
  };
}
