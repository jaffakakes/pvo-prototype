import assert from "node:assert/strict";
import test from "node:test";
import { planSavedTask } from "../../server/assistant/tasks/planner.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import { planTaskAttachment } from "../../server/assistant/attachments/planner.js";
import { claim, create } from "../assistant-tasks/fixtures.mjs";

const request = {
  kind: "history",
  collection: "questions",
  after: 0,
  offset: 0,
  notes: "Find the saved restaurant preference.",
};
const evidence = {
  archivedQuestions: 32,
  archivedOperations: 80,
  selection: null,
};
const adapters = {
  plan: (task, env, signal) => planSavedTask(task, env, signal, evidence),
  build: (task, env, signal) =>
    planSavedBuild(
      task,
      { agreement: null, feedback: [] },
      [],
      env,
      signal,
      evidence,
    ),
  attach: (task, env, signal) =>
    planTaskAttachment(
      task,
      {
        releaseId: "release-one",
        url: "https://restyle.example/actions",
        operations: [],
      },
      env,
      signal,
      evidence,
    ),
};
for (const [stage, plan] of Object.entries(adapters)) {
  test(`${stage} inference can select saved evidence without choosing ownership or external effects`, async () => {
    const task = claim(create());
    let calls = 0;
    const env = {
      AI: {
        run: async (_model, input) => {
          calls++;
          assert.deepEqual(
            JSON.parse(input.messages[1].content).evidence,
            evidence,
          );
          assert.ok(
            input.response_format.json_schema.anyOf.some(
              (choice) => choice.properties?.kind?.const === "history",
            ),
          );
          return { response: request };
        },
      },
    };
    assert.deepEqual(
      await plan(task, env, new AbortController().signal),
      request,
    );
    assert.equal(calls, 1);
    for (const invalid of [
      { ...request, ownerId: "other" },
      { ...request, collection: "credentials" },
      { ...request, offset: -1 },
      { ...request, notes: "x".repeat(4001) },
    ])
      await assert.rejects(
        plan(
          task,
          { AI: { run: async () => ({ response: invalid }) } },
          new AbortController().signal,
        ),
        { code: "invalid_result" },
      );
  });
}
