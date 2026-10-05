import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { parseTaskProposal } from "../packages/pvo-assistant/tasks/index.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { nativeGenerationSchema } from "../server/assistant/native/generationSchema.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

const cloudTask = {
  examples: [
    {
      id: "example",
      input: "Accept invitation",
      expected: "Acceptance is stored",
    },
  ],
};
const response = {
  message: "Starting saved planning",
  operations: [],
  observations: [],
  cloudTask,
};

test("only bounded behavior examples cross the native-to-saved-task handoff", () => {
  assert.deepEqual(parseNativeTurnResult(response), response);
  for (const extra of [
    { ownerId: "owner" },
    { url: "https://attacker.test" },
    { token: "secret" },
    { code: "fetch()" },
  ])
    assert.throws(() => parseTaskProposal({ ...cloudTask, ...extra }));
  assert.throws(() => parseTaskProposal({ examples: [] }));
  assert.throws(() =>
    parseTaskProposal({
      examples: [...cloudTask.examples, ...cloudTask.examples],
    }),
  );
  assert.throws(() =>
    parseTaskProposal({
      examples: [{ ...cloudTask.examples[0], expected: "💡".repeat(1000) }],
    }),
  );
  for (const extra of [
    { blocked: true },
    { answer: "done" },
    { observations: [{ kind: "web_search", query: "restaurant" }] },
    {
      operations: [
        { kind: "text.add", sceneId: "main", text: "Hi", start: 0, end: 1 },
      ],
    },
  ])
    assert.throws(() => parseNativeTurnResult({ ...response, ...extra }));
});

test("saved planning requires trusted capability, an edit request, and no prepared native edits", async () => {
  for (const settings of [
    { savedTasks: false },
    { savedTasks: true, mode: "ask" },
    { savedTasks: true, execution: { receipts: [{}] } },
  ]) {
    let calls = 0;
    const request = {
      ...nativeInput(),
      ...(settings.mode ? { mode: settings.mode } : {}),
      ...(settings.execution ? { execution: settings.execution } : {}),
    };
    await assert.rejects(
      nativeAssistantTurn(request, {
        models: {
          textAttemptMs: 1000,
          generate: async () => {
            calls++;
            return { content: response };
          },
        },
        signal: new AbortController().signal,
        savedTasks: settings.savedTasks,
        trace: () => {},
      }),
    );
    assert.ok(calls <= 2);
  }
  let calls = 0;
  const result = await nativeAssistantTurn(nativeInput(), {
    models: {
      textAttemptMs: 1000,
      generate: async () => {
        calls++;
        return { content: response };
      },
    },
    signal: new AbortController().signal,
    savedTasks: true,
    trace: () => {},
  });
  assert.deepEqual(result, response);
  assert.equal(
    calls,
    1,
    "A handoff is not a false terminal answer requiring another model call",
  );
  for (const options of [{}, { savedTasks: true, mode: "ask" }])
    assert.equal(
      nativeGenerationSchema(options).anyOf.some(
        (branch) => branch.properties.cloudTask,
      ),
      false,
    );
  assert.ok(
    nativeGenerationSchema({ savedTasks: true }).anyOf.some((branch) =>
      branch.required.includes("cloudTask"),
    ),
  );
});
