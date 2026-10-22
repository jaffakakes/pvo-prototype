import test from "node:test";
import assert from "node:assert/strict";
import { measuredModels } from "../../scripts/checks/restyle-capability/provider.mjs";
import {
  planningProbes,
  editorProbes,
  visionProbes,
} from "../../scripts/checks/restyle-capability/probes.mjs";
import {
  buildScenarios,
  repairFiles,
} from "../../scripts/checks/restyle-capability/build-scenarios.mjs";
import { parseServiceAgreement } from "../../packages/pvo-assistant/services/index.js";
import { parseBuilderResearchResult } from "../../packages/pvo-assistant/builder/index.js";
import { parseNativeTurnRequest } from "../../packages/pvo-assistant/native/index.js";
import { runCases } from "../../scripts/checks/model-comparison/review.mjs";

const response = (model = "kimi-k2.6") =>
  Response.json({
    model,
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: '{"message":"fixture"}' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
test("capture uses unchanged application model/settings and retains no credential", async () => {
  const saved = [];
  let sent;
  const models = await measuredModels(async (row) => saved.push(row), {
    apiKey: "DO-NOT-LOG",
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return response();
    },
  });
  await models.generate(
    { messages: [], schema: { type: "object" }, maxTokens: 6000 },
    AbortSignal.timeout(1000),
  );
  assert.equal(sent.model, "kimi-k2.6");
  assert.deepEqual(sent.thinking, { type: "disabled" });
  assert.equal(sent.temperature, 0.6);
  assert.equal(sent.max_tokens, 6000);
  assert.ok(!JSON.stringify(saved).includes("DO-NOT-LOG"));
  assert.equal(saved.at(-1).outcome, "returned");
  assert.equal(saved.at(-1).usage.input, 10);
});
test("a substituted model or provider failure cannot be counted as a valid baseline", async () => {
  const saved = [];
  const wrong = await measuredModels(async (row) => saved.push(row), {
    apiKey: "key",
    fetchImpl: async () => response("other-model"),
  });
  await assert.rejects(
    wrong.generate(
      { messages: [], schema: {}, maxTokens: 6000 },
      AbortSignal.timeout(1000),
    ),
  );
  assert.equal(saved.at(-1).returnedModel, "other-model");
  const outage = await measuredModels(async (row) => saved.push(row), {
    apiKey: "key",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(
    outage.generate(
      { messages: [], schema: {}, maxTokens: 6000 },
      AbortSignal.timeout(1000),
    ),
  );
  assert.equal(saved.at(-1).outcome, "transport_unknown");
  assert.equal(saved.at(-1).usage, null);
});
test("frozen fixtures match current request, feedback and agreement contracts", () => {
  const plans = planningProbes();
  for (const p of plans)
    for (const f of p.feedback) {
      const tool =
        f.kind === "connections_read"
          ? { kind: f.kind, after: null }
          : f.kind === "web_read"
            ? { kind: f.kind, url: f.result.result.url }
            : { kind: f.kind, query: "AgentMail documentation" };
      parseBuilderResearchResult(tool, f.result);
    }
  for (const p of editorProbes) parseNativeTurnRequest(p.request);
  for (const s of buildScenarios()) parseServiceAgreement(s.agreement);
  const ids = [
    ...plans,
    ...editorProbes,
    ...visionProbes,
    ...buildScenarios(),
  ].map((s) => s.id);
  assert.equal(ids.length, 21);
  assert.equal(new Set(ids).size, 21);
  assert.equal(repairFiles.length, 2);
});
test("independent connection checker rejects a canned correct answer that never made the expected request", async () => {
  const s = buildScenarios().find((s) => s.id === "B04");
  const bad = await runCases(
    { execute: async () => ({ result: "Saved example", state: null }) },
    { files: [], entrypoint: "src/service.mjs" },
    s.agreement,
    s.agreement.cases,
    (_request, step) => ({ title: step.expected.result }),
  );
  assert.equal(bad[0].status, "failed");
  assert.equal(bad[0].failure.code, "account_requests_mismatch");
  const good = await runCases(
    {
      execute: async (_files, _entry, input) =>
        input.connectionResults?.length
          ? { result: input.connectionResults[0].result.title, state: null }
          : { request: { connection: "issue", input: input.input } },
    },
    { files: [], entrypoint: "src/service.mjs" },
    s.agreement,
    s.holdouts,
    (_request, step) => ({ title: step.expected.result }),
  );
  assert.equal(good.length, 2);
  assert.ok(good.every((x) => x.status === "passed"));
});

test(
  "seeded repair starts from passing generated tests and a real independent behavior failure",
  { skip: process.env.RESTYLE_MODEL_SANDBOX !== "1", timeout: 30000 },
  async () => {
    const { comparisonSandbox } =
      await import("../../scripts/checks/model-comparison/sandbox.mjs");
    const { comparisonWorkspace, digest } =
      await import("../../scripts/checks/model-comparison/workspace.mjs");
    const { comparisonReview } =
      await import("../../scripts/checks/model-comparison/review.mjs");
    const { newBuilderState, acceptBuilderDecision } =
      await import("../../packages/pvo-assistant/builder/index.js");
    const { serializeServiceAgreement } =
      await import("../../packages/pvo-assistant/services/index.js");
    const resources = new Map();
    const sandbox = await comparisonSandbox(async (resource) =>
      resources.set(resource.name, resource),
    );
    const scenario = buildScenarios().find((s) => s.id === "R01");
    const workspace = comparisonWorkspace(sandbox);
    await workspace.execute(
      { kind: "workspace_write", expectedRevision: 0, files: scenario.seed },
      "seed-source",
    );
    const source = workspace.snapshot();
    let state = acceptBuilderDecision(
      newBuilderState(),
      { kind: "agreement", agreement: scenario.agreement },
      digest(serializeServiceAgreement(scenario.agreement)),
    );
    state = acceptBuilderDecision(state, {
      kind: "review",
      libraries: [],
      revision: source.revision,
      digest: source.digest,
      entrypoint: "src/service.mjs",
      tests: ["tests/service.test.mjs"],
    });
    const result = await comparisonReview(state, source, scenario, sandbox);
    assert.equal(result.generated.exitCode, 0);
    assert.equal(result.holdouts[0].failure.code, "mismatch");
    assert.equal(result.feedback.report, null);
    assert.ok([...resources.values()].every((r) => r.cleaned));
  },
);
