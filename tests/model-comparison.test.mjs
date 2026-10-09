import assert from "node:assert/strict";
import test from "node:test";
import {
  candidates,
  usageEstimate,
  comparisonProvider,
} from "../scripts/checks/model-comparison/providers.mjs";
import { comparisonScenarios } from "../scripts/checks/model-comparison/scenarios.mjs";
import { comparisonSandbox } from "../scripts/checks/model-comparison/sandbox.mjs";
import {
  comparisonWorkspace,
  digest,
} from "../scripts/checks/model-comparison/workspace.mjs";
import { comparisonReview } from "../scripts/checks/model-comparison/review.mjs";
import {
  newBuilderState,
  acceptBuilderDecision,
} from "../packages/pvo-assistant/builder/index.js";
import { serializeServiceAgreement } from "../packages/pvo-assistant/services/index.js";

test("comparison meters actual output once, including reasoning, and does not treat missing usage as free", () => {
  assert.equal(
    usageEstimate(candidates.sol, {
      input_tokens: 50000,
      output_tokens: 10000,
      output_tokens_details: { reasoning_tokens: 6000 },
    }).estimatedUsd,
    0.2,
  );
  assert.equal(
    usageEstimate(candidates.kimi, {
      prompt_tokens: 50000,
      completion_tokens: 10000,
    }).estimatedUsd,
    0.0875,
  );
  assert.equal(
    usageEstimate(candidates.sol, {
      input_tokens: 50000,
      output_tokens: 10000,
      input_tokens_details: { cached_tokens: 10000 },
    }).estimatedUsd,
    0.181,
  );
  assert.equal(usageEstimate(candidates.sol, null), null);
  assert.equal(
    usageEstimate(candidates.sol, {
      input_tokens: 1,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 2 },
    }),
    null,
  );
});

test("comparison uses identical schema instructions, keeps keys out of saved requests and journals rejected paid attempts", async () => {
  const prompts = [],
    journals = [];
  for (const name of ["kimi", "sol"]) {
    const provider = await comparisonProvider(
      name,
      async (row) => journals.push(structuredClone(row)),
      {
        apiKey: "private-test-key",
        fetchImpl: async (_url, options) => {
          const input = JSON.parse(options.body);
          prompts.push(input.input ?? input.messages);
          assert.equal(
            options.headers.Authorization,
            "Bearer private-test-key",
          );
          return Response.json({
            model: candidates[name].model,
            usage: { input_tokens: 100, output_tokens: 20 },
            ...(name === "sol"
              ? {
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      content: [
                        { type: "output_text", text: '{"kind":"review"}' },
                      ],
                    },
                  ],
                }
              : {
                  choices: [
                    {
                      finish_reason: "stop",
                      message: { content: '{"kind":"review"}' },
                    },
                  ],
                }),
          });
        },
      },
    );
    assert.equal(
      (
        await provider.generate(
          {
            messages: [{ role: "user", content: "same request" }],
            schema: { type: "object" },
          },
          AbortSignal.timeout(1000),
        )
      ).content,
      '{"kind":"review"}',
    );
  }
  assert.deepEqual(prompts[0], prompts[1]);
  assert.equal(journals[1].promptDigest, journals[3].promptDigest);
  assert.ok(!JSON.stringify(journals).includes("private-test-key"));
  const rejected = [];
  const provider = await comparisonProvider(
    "sol",
    async (row) => rejected.push(structuredClone(row)),
    {
      apiKey: "private-test-key",
      fetchImpl: async () =>
        Response.json(
          { error: { code: "insufficient_quota" } },
          { status: 429 },
        ),
    },
  );
  await assert.rejects(
    provider.generate({ messages: [], schema: {} }, AbortSignal.timeout(1000)),
    /HTTP 429/,
  );
  assert.equal(
    rejected[0].outcome,
    undefined,
    "Intent is saved before dispatch",
  );
  assert.equal(rejected[1].outcome, "provider_rejected");
  assert.equal(rejected[1].usage, null);
});

test("comparison refuses a provider-substituted model", async () => {
  const provider = await comparisonProvider("kimi", async () => {}, {
    apiKey: "test",
    fetchImpl: async () => Response.json({ model: "another-model" }),
  });
  await assert.rejects(
    provider.generate({ messages: [], schema: {} }, AbortSignal.timeout(1000)),
    /different model/,
  );
});

test("comparison fixtures preserve independent coverage of every agreed operation", () => {
  for (const scenario of comparisonScenarios()) {
    const covered = new Set(
      scenario.holdouts.flatMap((item) =>
        item.steps.map((step) => step.operation),
      ),
    );
    for (const operation of scenario.agreement.operations)
      assert.ok(covered.has(operation.name));
    assert.ok(
      !JSON.stringify(scenario.agreement.cases).includes(
        scenario.holdouts[0].id,
      ),
    );
  }
});

// Opt-in because ordinary repository checks must not require a running Docker daemon.
test(
  "actual isolated Node rejects wrong behavior despite passing generated tests, and removes its containers",
  { skip: process.env.RESTYLE_MODEL_SANDBOX !== "1", timeout: 30000 },
  async () => {
    const resources = new Map();
    const sandbox = await comparisonSandbox(async (row) =>
      resources.set(row.name, structuredClone(row)),
    );
    const scenario = comparisonScenarios().find(
      (item) => item.id === "booking",
    );
    const workspace = comparisonWorkspace(sandbox);
    const saved = await workspace.execute(
      {
        kind: "workspace_write",
        expectedRevision: 0,
        files: [
          {
            path: "src/main.mjs",
            content:
              "export function execute({state}){return {result:'accepted',state};}",
          },
          {
            path: "tests/main.test.mjs",
            content:
              "import test from 'node:test';test('claims success',()=>{});",
          },
        ],
      },
      "save-one",
    );
    let state = acceptBuilderDecision(
      newBuilderState(),
      { kind: "agreement", agreement: scenario.agreement },
      digest(serializeServiceAgreement(scenario.agreement)),
    );
    state = acceptBuilderDecision(state, {
      kind: "review",
      ...saved.result,
      entrypoint: "src/main.mjs",
      tests: ["tests/main.test.mjs"],
      libraries: [],
    });
    const checked = await comparisonReview(
      state,
      workspace.snapshot(),
      scenario,
      sandbox,
    );
    assert.equal(checked.generated.exitCode, 0);
    assert.equal(checked.feedback.report.status, "failed");
    assert.equal(checked.feedback.report.cases[0].failure.code, "mismatch");
    const probe = await sandbox.execute(
      [
        {
          path: "src/probe.mjs",
          content:
            "export async function execute({state}){let network;try{await fetch('https://example.com',{signal:AbortSignal.timeout(200)});network='escaped';}catch{network='denied';}return {result:{network,secret:process.env.OPENAI_API_KEY??null},state};}",
        },
      ],
      "src/probe.mjs",
      { state: null },
    );
    assert.deepEqual(probe, {
      result: { network: "denied", secret: null },
      state: null,
    });
    assert.ok(resources.size >= 3);
    assert.ok([...resources.values()].every((row) => row.cleaned));
  },
);
