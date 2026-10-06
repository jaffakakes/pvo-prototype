import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createTask,
  parseTaskRecord,
  TASK_LIMITS,
} from "../../packages/pvo-assistant/tasks/index.js";
import {
  newBuilderState,
  acceptBuilderDecision,
  builderContext,
  BUILDER_LIMITS,
} from "../../packages/pvo-assistant/builder/index.js";
import { parseServiceAgreement } from "../../packages/pvo-assistant/services/index.js";
import { authoringMessages } from "../../server/assistant/tasks/promptContext.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import { input, hash, now, ownerId } from "../assistant-tasks/fixtures.mjs";
import { taskFixture, expectStatus, path, saved } from "./helpers.mjs";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
function largeInput() {
  const value = input();
  value.context.components = Array.from({ length: 8 }, (_, index) => ({
    ...value.context.components[0],
    id: `form-${index}`,
    source: { structure: '"'.repeat(7500), style: "", logic: "" },
  }));
  return value;
}
function largeAgreement() {
  const state = '"'.repeat(8000);
  return parseServiceAgreement({
    description: "Preserve a long saved value during a read.",
    state: { schema: { type: "string", maxBytes: 8192 }, initial: state },
    operations: [
      {
        name: "read",
        description: "Read without changing the value.",
        audience: "public",
        access: "read",
        input: { type: "null" },
        result: { type: "null" },
      },
    ],
    cases: Array.from({ length: 6 }, (_, index) => ({
      id: `case-${index}`,
      description: "Keep the exact state.",
      initialState: state,
      steps: [
        {
          operation: "read",
          input: null,
          now,
          expected: { result: null, state },
        },
      ],
    })),
  });
}
const request = (collection) => ({
  kind: "history",
  collection,
  after: 0,
  offset: 0,
  notes: "Read the saved original before using omitted details.",
});
async function reconstruct(f, task, collection, after = 0) {
  let selected = { ...request(collection), after },
    content = "",
    pages = 0;
  do {
    const response = await f.control({
      action: "select-evidence",
      id: task.id,
      request: selected,
    });
    expectStatus(response, 200);
    const page = response.body;
    assert.ok(new TextEncoder().encode(page.content).length <= 4096);
    content += page.content;
    pages++;
    selected =
      page.nextOffset === null
        ? null
        : { ...selected, offset: page.nextOffset };
  } while (selected);
  return { value: content ? JSON.parse(content) : null, pages };
}

test("valid large goals and agreements fit one model request through explicit retrievable projections", async () => {
  const task = createTask(largeInput(), {
    id: "large-goal",
    ownerId,
    now,
    inputDigest: hash,
  });
  const context = builderContext(
    acceptBuilderDecision(
      newBuilderState(),
      { kind: "agreement", agreement: largeAgreement() },
      hash,
    ),
  );
  const original = structuredClone({ task, context });
  assert.ok(bytes(task.input) > 100 * 1024);
  assert.ok(bytes(context.agreement.body) > 200 * 1024);
  let sent;
  const decision = request("input");
  assert.deepEqual(
    await planSavedBuild(
      task,
      context,
      [],
      {
        AI: {
          run: async (_model, value) => {
            sent = value.messages;
            return { response: decision };
          },
        },
      },
      new AbortController().signal,
    ),
    decision,
  );
  assert.ok(bytes(sent) <= BUILDER_LIMITS.promptBytes);
  const projected = JSON.parse(sent[1].content);
  assert.equal(projected.input.request, task.input.request);
  assert.equal(projected.build.agreement.digest, hash);
  assert.equal(projected.build.lastDecision.contentOmitted, true);
  const smaller = authoringMessages(
    "Use the saved originals for omitted content.",
    { input: task.input, questions: [], build: context },
    96 * 1024,
  );
  assert.ok(bytes(smaller) <= 96 * 1024);
  assert.equal(
    JSON.parse(smaller[1].content).build.agreement.historyCollection,
    "agreement",
  );
  assert.deepEqual(
    { task, context },
    original,
    "Projection never mutates saved goals or agreements",
  );
});

test("large escaped answers checkpoint by bytes and every answer stays retrievable after restart", async () => {
  const f = await taskFixture();
  try {
    const project = await f.project();
    expectStatus(project, 200);
    const creation = await f.create(project.body.project.id, {
      context: largeInput().context,
    });
    expectStatus(creation, 201);
    let task = creation.body.task;
    const change = async (command) => {
      const response = await f.control({
        action: "step",
        id: task.id,
        command,
      });
      expectStatus(response, 200);
      task = response.body;
      assert.ok(bytes(task) <= TASK_LIMITS.recordBytes);
      parseTaskRecord(task);
    };
    for (let index = 0; index < 24; index++) {
      await change({
        kind: "claim",
        claimId: `worker-${index}`,
        leaseMs: 60000,
      });
      await change({
        kind: "ask",
        question: {
          id: `q-${index}`,
          revision: 0,
          prompt: `Detail ${index} ` + "\u0000".repeat(1980),
          choices: Array.from(
            { length: 6 },
            (_, choice) => `${choice}` + "\u0000".repeat(198),
          ),
          answer: null,
        },
      });
      await change({
        kind: "answer",
        questionId: `q-${index}`,
        questionRevision: 0,
        operationId: `a-${index}`,
        value: `Saved ${index} ` + "\u0000".repeat(3980),
      });
    }
    assert.equal(task.archivedQuestions + task.questions.length, 24);
    assert.ok(
      task.questions.length < 8,
      "Byte pressure archives before the count window is full",
    );
    await f.restart();
    assert.deepEqual((await f.request(path(task))).body.task, task);
    for (let index = 0; index < 24; index++) {
      const { value } = await reconstruct(f, task, "questions", index);
      assert.equal(value.id, `q-${index}`);
      assert.equal(value.answer.operationId, `a-${index}`);
      assert.equal(
        value.answer.value,
        `Saved ${index} ` + "\u0000".repeat(3980),
      );
    }
    assert.deepEqual((await reconstruct(f, task, "input")).value, task.input);
  } finally {
    await f.close();
  }
});

test("the full frozen agreement remains retrievable in bounded fragments", async () => {
  const agreement = largeAgreement();
  const f = await taskFixture({
    workspaces: true,
    planner: async (request) => {
      const task = await request.json();
      if (task.stepId === "plan")
        return Response.json({ kind: "checkpoint", stepId: "build" });
      if (!task.builderContext.agreement)
        return Response.json({ kind: "agreement", agreement });
      return Response.json({
        kind: "ask",
        prompt: "Keep the saved value?",
        choices: [],
      });
    },
  });
  try {
    let task = await saved(f);
    for (
      let end = Date.now() + 10000;
      Date.now() < end && task.state !== "waiting_for_answer";
    ) {
      await delay(20);
      task = (await f.request(path(task))).body.task;
    }
    assert.equal(task.state, "waiting_for_answer");
    const { value, pages } = await reconstruct(f, task, "agreement");
    assert.deepEqual(value.body, agreement);
    assert.ok(pages > 40);
    await f.restart();
    assert.deepEqual((await reconstruct(f, task, "agreement")).value, value);
  } finally {
    await f.close();
  }
});
