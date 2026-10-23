import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { candidates, usageEstimate } from "./providers.mjs";
import { comparisonScenarios } from "./scenarios.mjs";
import { digest } from "./workspace.mjs";
import { serializeServiceFiles } from "../../../packages/pvo-assistant/services/index.js";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Provide the private report path and the portable evidence output path.",
  );
const report = JSON.parse(await readFile(input, "utf8"));
assert.equal(report.policy, "restyle-coding-comparison-v1");
assert.ok(report.completedAt, "Do not summarize an in-flight report.");
const scenarios = comparisonScenarios();
assert.equal(report.builds.length, scenarios.length * 2);
const builds = report.builds.map((row) => {
  const candidate = candidates[row.candidate];
  assert.ok(candidate);
  assert.equal(row.model.model, candidate.model);
  const attempts = row.attempts.map((attempt) => {
    const usage = usageEstimate(candidate, attempt.response?.usage);
    return {
      sequence: attempt.sequence,
      requestedModel: attempt.requestedModel,
      returnedModel: attempt.returnedModel,
      status: attempt.status,
      outcome: attempt.outcome,
      promptDigest: attempt.promptDigest,
      elapsedMs: attempt.elapsedMs,
      providerUsage: attempt.response?.usage ?? null,
      usage,
      reasoningObserved:
        row.candidate === "kimi"
          ? Boolean(attempt.response?.choices?.[0]?.message?.reasoning_content)
          : (usage?.reasoning ?? 0) > 0,
    };
  });
  if (row.source)
    assert.equal(
      digest(serializeServiceFiles(row.source.files)),
      row.source.digest,
    );
  if (row.status === "passed") {
    assert.equal(row.reviews.at(-1).feedback.report.status, "passed");
    assert.equal(
      row.reviews.at(-1).feedback.report.identity.sourceDigest,
      row.source.digest,
    );
    assert.equal(
      row.reviews.at(-1).holdouts.length,
      scenarios.find((item) => item.id === row.scenario).holdouts.length,
    );
    assert.ok(
      row.reviews.at(-1).holdouts.every((item) => item.status === "passed"),
    );
  }
  return {
    scenario: row.scenario,
    candidate: row.candidate,
    configuration: candidate,
    status: row.status,
    elapsedMs: row.elapsedMs,
    inferenceMs: row.inferenceMs,
    knownEstimatedUsd: attempts.reduce(
      (sum, item) => sum + (item.usage?.estimatedUsd ?? 0),
      0,
    ),
    unknownUsageAttempts: attempts.filter((item) => !item.usage).length,
    calls: attempts.length,
    validationRepairs: row.validationRepairs,
    toolFailures: row.toolFailures,
    sourceRevisions: row.source?.revision ?? 0,
    attempts,
    reviews: row.reviews,
    finalSource: row.source,
  };
});
for (const scenario of scenarios) {
  const pair = builds.filter((row) => row.scenario === scenario.id);
  assert.equal(pair.length, 2);
  assert.deepEqual(
    new Set(pair.map((row) => row.candidate)),
    new Set(["kimi", "sol"]),
  );
  assert.equal(
    pair[0].attempts[0].promptDigest,
    pair[1].attempts[0].promptDigest,
    "Initial prompts must match in each pair.",
  );
}
const aggregates = Object.keys(candidates).map((candidate) => {
  const rows = builds.filter((row) => row.candidate === candidate),
    successes = rows.filter((row) => row.status === "passed").length;
  const totalKnownEstimatedUsd = rows.reduce(
    (sum, row) => sum + row.knownEstimatedUsd,
    0,
  );
  return {
    candidate,
    model: candidates[candidate].model,
    builds: rows.length,
    successes,
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    totalKnownEstimatedUsd,
    knownEstimatedUsdPerSuccess: successes
      ? totalKnownEstimatedUsd / successes
      : null,
    unknownUsageAttempts: rows.reduce(
      (sum, row) => sum + row.unknownUsageAttempts,
      0,
    ),
    meanElapsedSeconds:
      rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length / 1000,
    meanInferenceSeconds:
      rows.reduce((sum, row) => sum + row.inferenceMs, 0) / rows.length / 1000,
  };
});
const evidence = {
  policy: report.policy,
  startedAt: report.startedAt,
  completedAt: report.completedAt,
  scope: report.scope,
  runtime: report.runtime,
  modelTurnLimit: report.modelTurnLimit,
  outputTokensPerInference: 32768,
  inferenceTimeoutMs: 180000,
  priceDate: "2026-10-09",
  currency: "USD",
  pricesAreEstimates: true,
  meteringNote:
    "Repriced from original provider usage, including Sol cache writes at $2.50/M. The early live console omitted the cache-write premium; these evidence values supersede it. Reasoning tokens are counted once within output tokens.",
  scenarios,
  builds,
  aggregates,
  resources: report.resources,
  cleanupVerified: report.resources.every((row) => row.cleaned),
};
assert.equal(evidence.cleanupVerified, true);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      aggregates,
      cleanupVerified: evidence.cleanupVerified,
      containerCount: evidence.resources.length,
      totalKnownEstimatedUsd: aggregates.reduce(
        (sum, item) => sum + item.totalKnownEstimatedUsd,
        0,
      ),
    },
    null,
    2,
  ),
);
