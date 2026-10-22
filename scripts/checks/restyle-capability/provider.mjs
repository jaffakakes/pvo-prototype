import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  runpodNativeModels,
  RUNPOD_NATIVE_MODEL,
} from "../../../server/assistant/native/runpod.js";
import { usageEstimate } from "../model-comparison/providers.mjs";

export const baseline = Object.freeze({
  model: RUNPOD_NATIVE_MODEL,
  thinking: "disabled",
  temperature: 0.6,
  inputRate: 0.95,
  cachedRate: 0.95,
  outputRate: 4,
});

/** Observe the unchanged application adapter. Never retain HTTP headers or credentials. */
export async function measuredModels(save, { apiKey, fetchImpl = fetch } = {}) {
  apiKey ??= JSON.parse(
    await readFile(
      homedir() + "/.codex/secure/restyle-beta-backend/worker-secrets.json",
      "utf8",
    ),
  ).RUNPOD_API_KEY;
  let sequence = 0;
  return runpodNativeModels(apiKey, {
    fetch: async (url, options) => {
      const request = JSON.parse(options.body);
      const attempt = {
        sequence: ++sequence,
        startedAt: new Date().toISOString(),
        request,
        promptDigest: createHash("sha256").update(options.body).digest("hex"),
      };
      await save(structuredClone(attempt));
      const start = performance.now();
      try {
        const response = await fetchImpl(url, options);
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
          usage: usageEstimate(baseline, body?.usage),
          outcome: response.ok ? "returned" : "provider_rejected",
        });
        await save(structuredClone(attempt));
        if (
          response.ok &&
          body?.model !== baseline.model &&
          !body?.model?.startsWith(baseline.model + "-")
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
    },
  });
}
