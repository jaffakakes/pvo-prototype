import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDER_TOOL_KINDS,
  builderToolDefinitions,
  parseBuilderDecision,
  builderDecisionSchema,
} from "../../packages/pvo-assistant/builder/index.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import {
  dinnerAgreement,
  equipmentAgreement,
} from "../service-packages/fixtures.mjs";
import { create, claim } from "../assistant-tasks/fixtures.mjs";
const stage = (hasAgreement) => ({
  hasAgreement,
  available: BUILDER_TOOL_KINDS,
});
const definitions = builderToolDefinitions(BUILDER_TOOL_KINDS);
const signal = () => new AbortController().signal;
const review = {
  kind: "review",
  libraries: [],
  revision: 1,
  digest: "d".repeat(64),
  entrypoint: "src/service.mjs",
  tests: ["tests/service.test.mjs"],
};

function provider(response, extra = {}) {
  const calls = [];
  return {
    calls,
    env: {
      ASSISTANT_PROVIDER: "cloudflare",
      ASSISTANT_BUDGET: {},
      AI: {
        async run(model, input) {
          calls.push({ model, input });
          return { response, ...extra };
        },
      },
      SESSION_SECRET: "private-session-value",
      CLOUDFLARE_API_TOKEN: "private-provider-value",
    },
  };
}

test("builder decisions freeze the agreement before source and reject model readiness or ownership", () => {
  for (const agreement of [dinnerAgreement(), equipmentAgreement()]) {
    assert.deepEqual(
      parseBuilderDecision({ kind: "agreement", agreement }, stage(false)),
      { kind: "agreement", agreement },
    );
    assert.throws(() =>
      parseBuilderDecision({ kind: "agreement", agreement }, stage(true)),
    );
  }
  assert.throws(() =>
    parseBuilderDecision(
      { kind: "tools", review: null, calls: [{ kind: "workspace_list" }] },
      stage(false),
    ),
  );
  assert.throws(() => parseBuilderDecision(review, stage(false)));
  assert.deepEqual(parseBuilderDecision(review, stage(true)), review);
  for (const value of [
    { ...review, ready: true },
    { ...review, ownerId: "other" },
    { kind: "complete", url: "https://invented.example" },
    { kind: "tools", review: null, calls: [] },
    {
      kind: "tools",
      review: null,
      calls: Array(5).fill({ kind: "workspace_list" }),
    },
    { ...review, tests: ["src/service.mjs"] },
    { ...review, tests: ["tests/service.test.mjs", "tests/service.test.mjs"] },
  ])
    assert.throws(() => parseBuilderDecision(value, stage(true)));
  assert.throws(() =>
    parseBuilderDecision(
      { kind: "tools", review: null, calls: [{ kind: "workspace_list" }] },
      { hasAgreement: true, available: [] },
    ),
  );
});

test("builder schema exposes only the current stage and actually available tools", () => {
  const initial = builderDecisionSchema(false, definitions);
  assert.deepEqual(
    initial.anyOf.map((value) => value.properties.kind.const),
    ["ask", "agreement", "manual_alternative"],
  );
  const available = builderDecisionSchema(
    true,
    builderToolDefinitions(["workspace_list"]),
  );
  assert.deepEqual(
    available.anyOf[1].properties.calls.items.anyOf.map(
      (value) => value.properties.kind.const,
    ),
    ["workspace_list"],
  );
  assert.deepEqual(
    builderDecisionSchema(true, []).anyOf.map(
      (value) => value.properties.kind.const,
    ),
    ["ask", "review"],
  );
});

test("the builder inference uses saved task goals and feedback without platform credentials", async () => {
  const task = claim(create());
  const agreement = dinnerAgreement();
  const mock = provider({ kind: "agreement", agreement });
  assert.deepEqual(
    await planSavedBuild(
      task,
      { agreement: null, feedback: [] },
      definitions,
      mock.env,
      signal(),
    ),
    { kind: "agreement", agreement },
  );
  const sent = JSON.stringify(mock.calls);
  assert.ok(sent.includes(task.input.request));
  assert.ok(!sent.includes("private-session-value"));
  assert.ok(!sent.includes("private-provider-value"));
  assert.equal(mock.calls.length, 1);
  const toolResponse = {
    kind: "tools",
    review: null,
    calls: [{ kind: "workspace_list" }],
  };
  const repairing = provider(JSON.stringify(toolResponse));
  const feedback = [
    {
      id: "test",
      result: {
        exitCode: 1,
        stdout: "Expected capacity limit, received accepted",
      },
    },
  ];
  assert.deepEqual(
    await planSavedBuild(
      task,
      { agreement, feedback },
      definitions,
      repairing.env,
      signal(),
    ),
    toolResponse,
  );
  assert.ok(
    JSON.stringify(repairing.calls).includes(feedback[0].result.stdout),
  );
});

test("builder output cannot bypass its stage, invent tool receipts or emit provider tool calls", async () => {
  const task = claim(create());
  for (const output of [
    review,
    { kind: "tools", review: null, calls: [{ kind: "workspace_list" }] },
    "not JSON",
    { kind: "agreement", agreement: { passed: true } },
  ])
    await assert.rejects(
      planSavedBuild(
        task,
        { agreement: null },
        definitions,
        provider(output).env,
        signal(),
      ),
      (error) => error.code === "invalid_result",
    );
  await assert.rejects(
    planSavedBuild(
      task,
      { agreement: dinnerAgreement() },
      definitions,
      provider(review, { tool_calls: [{ name: "deploy" }] }).env,
      signal(),
    ),
    (error) => error.code === "invalid_result",
  );
  await assert.rejects(
    planSavedBuild(
      task,
      { agreement: dinnerAgreement(), feedback: ["x".repeat(700 * 1024)] },
      definitions,
      provider(review).env,
      signal(),
    ),
    (error) => error.code === "invalid_result",
  );
});
