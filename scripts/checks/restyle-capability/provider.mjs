import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  runpodNativeModels,
  RUNPOD_NATIVE_MODEL,
  RUNPOD_AUTHORING_MODEL,
} from "../../../server/assistant/native/runpod.js";
import { usageEstimate } from "../model-comparison/providers.mjs";

export const authoringConfiguration = Object.freeze({
  model: RUNPOD_AUTHORING_MODEL,
  reasoning: "low",
  temperature: 1,
  minimumOutputTokens: 16000,
  inputRate: 3,
  cachedRate: 3,
  outputRate: 15,
});
export const baseline = Object.freeze({
  model: RUNPOD_NATIVE_MODEL,
  thinking: "disabled",
  temperature: 0.6,
  inputRate: 0.95,
  cachedRate: 0.95,
  outputRate: 4,
  authoring: authoringConfiguration,
});

/** Capture the actual provider wire request without retaining headers or credentials. */
export async function measuredFetch(
  save,
  { apiKey, fetchImpl = fetch, candidate } = {},
) {
  apiKey ??= JSON.parse(
    await readFile(
      homedir() + "/.codex/secure/restyle-beta-backend/worker-secrets.json",
      "utf8",
    ),
  ).RUNPOD_API_KEY;
  let sequence = 0;
  return async (url, options) => {
    if (
      String(url) !==
      "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions"
    )
      throw new Error(
        "Evaluation credentials are restricted to the configured model endpoint.",
      );
    const request = JSON.parse(options.body);
    const configuration =
      candidate ??
      (request.model === authoringConfiguration.model
        ? authoringConfiguration
        : baseline);
    if (request.model !== configuration.model)
      throw new Error("The evaluation did not declare this requested model.");
    const attempt = {
      sequence: ++sequence,
      startedAt: new Date().toISOString(),
      request,
      configuration,
      promptDigest: createHash("sha256").update(options.body).digest("hex"),
    };
    await save(structuredClone(attempt));
    const start = performance.now();
    try {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);
      const response = await fetchImpl(url, { ...options, headers });
      // Copy the bounded provider body once so capture cannot leak an unconsumed tee.
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 128 * 1024)
          throw new Error("Evaluation provider body exceeded the app bound.");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      let body = null;
      try {
        body = JSON.parse(bytes.toString());
      } catch {
        /* App validates malformed bodies. */
      }
      Object.assign(attempt, {
        elapsedMs: performance.now() - start,
        status: response.status,
        response: body,
        returnedModel: body?.model ?? null,
        usage: usageEstimate(configuration, body?.usage),
        outcome: response.ok ? "returned" : "provider_rejected",
      });
      await save(structuredClone(attempt));
      if (
        response.ok &&
        body?.model !== configuration.model &&
        !body?.model?.startsWith(configuration.model + "-")
      )
        throw new Error("Provider model mismatch; baseline is invalid.");
      return new Response(bytes, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (!attempt.outcome) {
        Object.assign(attempt, {
          elapsedMs: performance.now() - start,
          outcome: "transport_unknown",
          usage: null,
        });
        await save(structuredClone(attempt));
      }
      throw error;
    }
  };
}

/** Use the application adapter and the same recorded transport as durable evaluation. */
export async function measuredModels(save, options) {
  return runpodNativeModels("evaluation-transport", {
    fetch: await measuredFetch(save, options),
  });
}

/** Forward model bytes, never the local Worker's transport headers. */
export async function forwardModelRequest(send, request) {
  return send(request.url, {
    method: request.method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: await request.text(),
    signal: request.signal,
    redirect: "manual",
  });
}
