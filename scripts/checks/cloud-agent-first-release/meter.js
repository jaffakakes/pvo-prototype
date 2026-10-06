import { readBounded } from "../cloud-agent-infrastructure/proof-http.js";
import { runpodNativeModels } from "../../../server/assistant/native/runpod.js";

// A disposable test's dollar allowance, not a goal-wide model-turn policy.
export const MODEL_LIMITS = Object.freeze({
  allowanceMicros: 7_500_000,
  reservationMicros: 275_000,
  maxOutputTokens: 6000,
  maxRequestBytes: 1024 * 1024,
});

export function validateModelRequest(url, init) {
  if (
    url !==
      "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions" ||
    init.method !== "POST" ||
    init.redirect !== "manual" ||
    typeof init.body !== "string" ||
    new TextEncoder().encode(init.body).length > MODEL_LIMITS.maxRequestBytes
  )
    throw new Error("Unexpected paid model request.");
  const payload = JSON.parse(init.body);
  if (
    payload.model !== "kimi-k2.6" ||
    payload.stream !== false ||
    !Number.isSafeInteger(payload.max_tokens) ||
    payload.max_tokens < 1 ||
    payload.max_tokens > MODEL_LIMITS.maxOutputTokens ||
    payload.thinking?.type !== "disabled"
  )
    throw new Error("Paid model request exceeds the reviewed plan.");
}

export function reportedUsage(body) {
  const usage = body?.usage;
  if (
    !usage ||
    ![usage.prompt_tokens, usage.completion_tokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    estimatedMicros: Math.ceil(
      usage.prompt_tokens * 0.95 + usage.completion_tokens * 4,
    ),
  };
}

/** Durable, conservative reservations survive unknown responses and worker restarts. */
export class ProofModelMeter {
  constructor(storage, { settleReportedUsage = false } = {}) {
    this.storage = storage;
    this.settleReportedUsage = settleReportedUsage;
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS proof_model_calls (id TEXT PRIMARY KEY, reserved INTEGER NOT NULL, status INTEGER, usage TEXT)",
    );
  }
  reserve(expiresAt) {
    return this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const used = sql
        .exec(
          this.settleReportedUsage
            ? "SELECT COALESCE(SUM(CASE WHEN usage IS NULL THEN reserved ELSE json_extract(usage, '$.estimatedMicros') END),0) AS used FROM proof_model_calls"
            : "SELECT COALESCE(SUM(reserved),0) AS used FROM proof_model_calls",
        )
        .one().used;
      if (
        !Number.isSafeInteger(expiresAt) ||
        Date.now() >= expiresAt ||
        used + MODEL_LIMITS.reservationMicros > MODEL_LIMITS.allowanceMicros
      )
        throw new Error("The approved diagnostic model allowance has ended.");
      const id = crypto.randomUUID();
      sql.exec(
        "INSERT INTO proof_model_calls (id,reserved) VALUES (?,?)",
        id,
        MODEL_LIMITS.reservationMicros,
      );
      return id;
    });
  }
  settle(id, status, usage) {
    this.storage.sql.exec(
      "UPDATE proof_model_calls SET status=?,usage=? WHERE id=?",
      status,
      usage === null ? null : JSON.stringify(usage),
      id,
    );
  }
  report() {
    return this.storage.sql
      .exec(
        "SELECT id,reserved,status,usage FROM proof_model_calls ORDER BY rowid",
      )
      .toArray()
      .map((row) => ({
        ...row,
        usage: row.usage === null ? null : JSON.parse(row.usage),
      }));
  }
}

export function meteredModels(env, meter) {
  return runpodNativeModels(env.RUNPOD_API_KEY, {
    fetch: async (url, init) => {
      validateModelRequest(url, init);
      const id = await meter.reserve(Number(env.PROOF_EXPIRES_AT));
      const response = await fetch(url, init);
      // Only token counts/status are retained; never provider credentials or request headers.
      let usage = null;
      try {
        const text = await readBounded(response.clone().body, 128 * 1024);
        if (text.length <= 128 * 1024) usage = reportedUsage(JSON.parse(text));
      } catch {
        /* Unknown usage keeps the full conservative reservation. */
      }
      await meter.settle(id, response.status, usage);
      return response;
    },
  });
}
