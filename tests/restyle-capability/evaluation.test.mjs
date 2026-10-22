import test from "node:test";
import assert from "node:assert/strict";
import {
  measuredModels,
  measuredFetch,
  forwardModelRequest,
} from "../../scripts/checks/restyle-capability/provider.mjs";
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

test("the durable model bridge forwards JSON and cancellation without local transport headers", async () => {
  const controller = new AbortController();
  const body = JSON.stringify({ model: "kimi-k2.6", messages: [] });
  const request = new Request(
    "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions",
    {
      method: "POST",
      body,
      signal: controller.signal,
      headers: {
        "Content-Length": "1",
        Host: "local-worker.test",
        Authorization: "Bearer local-placeholder",
        "X-MF-Original-URL": "http://local-worker.test/private",
      },
    },
  );
  await forwardModelRequest(async (url, options) => {
    assert.equal(url, request.url);
    assert.equal(options.body, body);
    assert.equal(options.redirect, "manual");
    assert.deepEqual(options.headers, {
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    controller.abort();
    assert.equal(options.signal.aborted, true);
    return response();
  }, request);
});
test("native capture records application editing settings and retains no credential", async () => {
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
test("saved-authoring capture verifies its declared model and prices that model's usage", async () => {
  const saved = [];
  const models = await measuredModels(async (row) => saved.push(row), {
    apiKey: "private-key",
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, "kimi-k3");
      return response("kimi-k3");
    },
  });
  await models.generate(
    { messages: [], schema: {}, maxTokens: 1200, purpose: "saved_authoring" },
    AbortSignal.timeout(1000),
  );
  const attempt = saved.at(-1);
  assert.equal(attempt.configuration.model, "kimi-k3");
  assert.equal(attempt.usage.estimatedUsd, (10 * 3 + 5 * 15) / 1000000);
  assert.equal(attempt.request.max_tokens, 16000);
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

test("durable inference forwarding restricts the credential destination and excludes headers from journals", async () => {
  const saved = [];
  let calls = 0;
  const send = await measuredFetch(async (row) => saved.push(row), {
    apiKey: "private-evaluation-key",
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(
        options.headers.get("authorization"),
        "Bearer private-evaluation-key",
      );
      return response();
    },
  });
  const options = {
    method: "POST",
    headers: { authorization: "Bearer fixture-placeholder" },
    body: JSON.stringify({ model: "kimi-k2.6", messages: [] }),
  };
  await assert.rejects(
    send("https://unrelated.example/model", options),
    /restricted/,
  );
  assert.equal(calls, 0);
  assert.equal(saved.length, 0);
  await send(
    "https://api.runpod.ai/v2/moonshot-kimi/openai/v1/chat/completions",
    options,
  );
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(saved).includes("private-evaluation-key"));
  assert.ok(!JSON.stringify(saved).includes("fixture-placeholder"));
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
  assert.equal(bad[0].failure.code, "mismatch");
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

test("live builder repair receives the actual rejected proposal as text and can ask for help", async () => {
  const { runBuild } =
    await import("../../scripts/checks/restyle-capability/build.mjs");
  const row = { repetition: 1, attempts: [] };
  let calls = 0;
  await runBuild(
    buildScenarios()[0],
    row,
    {},
    {
      generate: async ({ messages }) => {
        calls++;
        if (calls === 1) return { content: '{"kind":"invented"}' };
        assert.ok(messages.every((m) => typeof m.content === "string"));
        assert.ok(
          messages.some(
            (m) =>
              m.role === "assistant" && m.content === '{"kind":"invented"}',
          ),
        );
        return {
          content: JSON.stringify({
            kind: "ask",
            prompt: "Which name should appear?",
            choices: ["Ari", "Bo"],
          }),
        };
      },
    },
    async () => {},
  );
  assert.equal(calls, 2);
  assert.equal(row.validationRepairs, 1);
  assert.equal(row.status, "needs_creator_input");
});

test("missing account request reaches the real report parser as actionable independent feedback", async () => {
  const { comparisonReview } =
    await import("../../scripts/checks/model-comparison/review.mjs");
  const { comparisonWorkspace, digest } =
    await import("../../scripts/checks/model-comparison/workspace.mjs");
  const { newBuilderState, acceptBuilderDecision } =
    await import("../../packages/pvo-assistant/builder/index.js");
  const { serializeServiceAgreement } =
    await import("../../packages/pvo-assistant/services/index.js");
  const scenario = buildScenarios().find((s) => s.id === "B04");
  const sandbox = {
    command: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    execute: async () => ({ result: "Saved example", state: null }),
  };
  const workspace = comparisonWorkspace(sandbox);
  await workspace.execute(
    {
      kind: "workspace_write",
      expectedRevision: 0,
      files: [
        {
          path: "src/main.mjs",
          content:
            "export function execute(){return {result:'Saved example',state:null};}",
        },
        {
          path: "tests/main.test.mjs",
          content: "import test from 'node:test'; test('shallow',()=>{});",
        },
      ],
    },
    "seed-connected",
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
    entrypoint: "src/main.mjs",
    tests: ["tests/main.test.mjs"],
  });
  const result = await comparisonReview(
    state,
    source,
    {
      ...scenario,
      resolveAccount: (_request, step) => ({ title: step.expected.result }),
    },
    sandbox,
  );
  assert.equal(result.feedback.error, null);
  assert.equal(result.feedback.report.status, "failed");
  assert.match(
    result.feedback.report.cases[0].failure.detail,
    /Actual account requests/,
  );
});

test("evaluation history uses real byte-bounded fragments and honest exhaustion", async () => {
  const { selectBuildHistory } =
    await import("../../scripts/checks/restyle-capability/history.mjs");
  const row = { decisions: [], reviews: [], operations: [], repairs: [] };
  const task = { input: { text: "🙂".repeat(3000) }, questions: [] };
  const request = {
    kind: "history",
    collection: "input",
    after: 0,
    offset: 0,
    notes: "saved notes",
  };
  const first = selectBuildHistory(
    request,
    task,
    { agreement: null },
    row,
    null,
  );
  assert.equal(first.selection.sequence, 1);
  assert.ok(Buffer.byteLength(first.selection.content) <= 4096);
  assert.ok(first.selection.nextOffset > 0);
  const second = selectBuildHistory(
    request,
    task,
    { agreement: null },
    row,
    null,
  );
  assert.equal(second.progress[0].repetitions, 2);
  const empty = selectBuildHistory(
    { ...request, after: 1 },
    task,
    { agreement: null },
    row,
    null,
  );
  assert.equal(empty.selection.sequence, null);
  assert.equal(empty.selection.content, "");
  assert.equal(empty.selection.nextOffset, null);
});
