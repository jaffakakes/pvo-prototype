import assert from "node:assert/strict";
import test from "node:test";
import { runpodNativeModels } from "../../server/assistant/native/runpod.js";
import { planSavedTask } from "../../server/assistant/tasks/planner.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import { planTaskAttachment } from "../../server/assistant/attachments/planner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
import { attachment } from "../service-attachments/fixtures.mjs";

function modelsFor(output) {
  return runpodNativeModels("private-test-key", {
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.response_format, { type: "json_object" });
      assert.equal(payload.messages[0].role, "system");
      assert.match(payload.messages[0].content, /"anyOf"/);
      assert.doesNotMatch(options.body, /private-test-key/);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output) },
          },
        ],
      });
    },
  });
}

const task = () => claim(create());
const signal = () => new AbortController().signal;
const cases = [
  {
    name: "saved planning",
    run: (models) => planSavedTask(task(), {}, signal(), null, models),
    valid: { kind: "build" },
    expected: { kind: "checkpoint", stepId: "build" },
    invalid: [
      { kind: "build", ready: true },
      { kind: "complete", url: "https://invented.example" },
    ],
  },
  {
    name: "behavior agreement planning",
    run: (models) =>
      planSavedBuild(
        task(),
        { agreement: null },
        [],
        {},
        signal(),
        null,
        models,
      ),
    valid: { kind: "agreement", agreement: dinnerAgreement() },
    expected: { kind: "agreement", agreement: dinnerAgreement() },
    invalid: [
      { kind: "agreement", agreement: dinnerAgreement(), passed: true },
      { kind: "tools", review: null, calls: [{ kind: "workspace_list" }] },
    ],
  },
  {
    name: "component attachment planning",
    run: (models) =>
      planTaskAttachment(
        task(),
        {
          releaseId: "release-one",
          url: "https://restyle.example/api/services/service-one/actions",
          operations: [],
        },
        {},
        signal(),
        null,
        models,
      ),
    valid: attachment("release-one"),
    expected: attachment("release-one"),
    invalid: [
      { ...attachment("release-one"), receipt: { ready: true } },
      { ...attachment("release-one"), ownerId: "other-owner" },
    ],
  },
];

for (const example of cases) {
  test(`Runpod JSON mode keeps ${example.name} under local validation`, async () => {
    assert.deepEqual(
      await example.run(modelsFor(example.valid)),
      example.expected,
    );
    for (const invalid of example.invalid) {
      await assert.rejects(example.run(modelsFor(invalid)), {
        code: "invalid_result",
      });
    }
  });
}

test("builder repair receives the actual local agreement failure, while provider errors stay outside feedback", async () => {
  const agreement = dinnerAgreement();
  agreement.state.schema.fields.push({
    name: "fullAt",
    description: "Optional timestamp",
    schema: { type: "null" },
  });
  agreement.state.initial.fullAt = null;
  for (const entry of agreement.cases) {
    entry.initialState.fullAt = null;
    for (const step of entry.steps) step.expected.state.fullAt = null;
  }
  agreement.cases[0].steps[0].expected.state.fullAt = 1000;
  const proposed = { kind: "agreement", agreement };
  const run = (models) =>
    planSavedBuild(task(), { agreement: null }, [], {}, signal(), null, models);
  await assert.rejects(run(modelsFor(proposed)), (error) => {
    assert.equal(error.code, "invalid_result");
    assert.match(
      error.feedback.message,
      /Proposed service state.fullAt must be null/,
    );
    assert.deepEqual(JSON.parse(error.feedback.proposal.text), proposed);
    return true;
  });
  for (const entry of agreement.cases)
    for (const step of entry.steps) step.expected.state.fullAt = null;
  assert.deepEqual(await run(modelsFor(proposed)), proposed);
  const providerError = new Error("private provider failure");
  await assert.rejects(
    run({
      generate: async () => {
        throw providerError;
      },
    }),
    (error) => error === providerError && !error.feedback,
  );
});

test("an accepted agreement stays authoritative while stale repair history is present", async () => {
  const agreement = dinnerAgreement();
  const decision = {
    kind: "tools",
    calls: [{ kind: "workspace_list" }],
    review: null,
  };
  const context = { agreement: { digest: "a".repeat(64), body: agreement } };
  const evidence = {
    repair: {
      message: "Builder stage is unsupported.",
      proposal: {
        text: JSON.stringify({ kind: "agreement", agreement }),
        truncated: false,
      },
    },
  };
  let request;
  const models = {
    generate: async (value) => {
      request = value;
      return { content: JSON.stringify(decision) };
    },
  };
  assert.deepEqual(
    await planSavedBuild(
      task(),
      context,
      [{ kind: "workspace_list", description: "List saved source" }],
      {},
      signal(),
      evidence,
      models,
    ),
    decision,
  );
  assert.match(request.messages[0].content, /already accepted and immutable/);
  assert.deepEqual(
    JSON.parse(request.messages[1].content).build.agreement,
    context.agreement,
  );
  assert.deepEqual(JSON.parse(request.messages[1].content).evidence, evidence);
  await assert.rejects(
    planSavedBuild(
      task(),
      context,
      [],
      {},
      signal(),
      evidence,
      modelsFor({ kind: "agreement", agreement }),
    ),
    { code: "invalid_result" },
  );
});

test("nested agreement field failures identify the missing contract field and the corrected proposal is accepted", async () => {
  const agreement = dinnerAgreement();
  const field = agreement.operations[0].input.fields[0];
  const description = field.description;
  delete field.description;
  field.privateExtra = "private-value-must-not-enter-diagnostic";
  const proposed = { kind: "agreement", agreement };
  const run = () =>
    planSavedBuild(
      task(),
      { agreement: null },
      [],
      {},
      signal(),
      null,
      modelsFor(proposed),
    );
  await assert.rejects(run(), (error) => {
    assert.match(
      error.feedback.message,
      /Required fields: name, description, schema/,
    );
    assert.match(
      error.feedback.message,
      /Missing required fields: description/,
    );
    assert.doesNotMatch(error.feedback.message, /privateExtra|private-value/);
    return true;
  });
  delete field.privateExtra;
  field.description = description;
  assert.deepEqual(await run(), proposed);
});
