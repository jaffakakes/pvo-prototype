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
