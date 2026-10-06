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

test("a bounded repair conversation ends with local rejection feedback and never promotes it into system instructions", () => {
  const proposal = JSON.stringify({
    kind: "tools",
    calls: [
      {
        kind: "workspace_read",
        revision: 1,
        path: "src/service.mjs",
        offset: 0,
        digest: "wrong-extra-field",
      },
    ],
    review: null,
  });
  const repair = {
    check: "builder_response",
    message: "workspace_read accepts only kind, revision, path, offset",
    proposal: { text: proposal, truncated: false },
  };
  const input = {
    input: { context: { components: [] }, examples: [] },
    evidence: { repair },
  };
  const messages = authoringMessages(
    "Trusted platform instructions",
    input,
    8192,
  );
  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.equal(messages[0].content, "Trusted platform instructions");
  assert.equal(messages[2].content, proposal);
  assert.deepEqual(JSON.parse(messages[3].content).localValidation, {
    check: repair.check,
    message: repair.message,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) <= 8192);
  assert.equal(input.evidence.repair.proposal.text, proposal);
  input.evidence.repair.proposal.truncated = true;
  assert.equal(
    authoringMessages("Trusted platform instructions", input, 8192).length,
    3,
    "An incomplete proposal remains marked as truncated context",
  );
});

test("completed builder decisions are followed by their actual batch results instead of being repeated as a fresh request", () => {
  const decision = {
    kind: "tools",
    review: null,
    calls: [
      {
        kind: "workspace_test",
        revision: 2,
        digest: "d".repeat(64),
        paths: ["tests/main.test.mjs"],
      },
    ],
  };
  const current = {
    operationId: "build-7-0",
    kind: "workspace_test",
    result: {
      status: "completed",
      result: { exitCode: 0, stdout: "9 tests passed; untrusted log text" },
    },
  };
  const input = {
    input: { context: { components: [] }, examples: [] },
    build: {
      round: 7,
      lastDecision: decision,
      batchEnd: "completed",
      feedback: [
        {
          operationId: "build-6-0",
          kind: "workspace_test",
          result: { exitCode: 1 },
        },
        current,
      ],
    },
  };
  const original = structuredClone(input);
  const messages = authoringMessages("Trusted instructions", input, 8192);
  assert.deepEqual(
    messages.map((x) => x.role),
    ["system", "user", "assistant", "user"],
  );
  assert.deepEqual(JSON.parse(messages[2].content), decision);
  assert.deepEqual(JSON.parse(messages[3].content).observed, {
    batchOutcome: "completed",
    toolResults: [current],
  });
  assert.match(
    JSON.parse(messages[3].content).nextAction,
    /request independent review/,
  );
  assert.equal(messages[0].content, "Trusted instructions");
  assert.deepEqual(input, original);
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) <= 8192);
  input.build.batchEnd = null;
  assert.equal(
    authoringMessages("Trusted instructions", input, 8192).length,
    2,
  );
  input.build.batchEnd = "completed";
  input.build.lastDecision = { kind: "tools", contentOmitted: true };
  assert.equal(
    authoringMessages("Trusted instructions", input, 8192).length,
    2,
  );
});

test("repair projection includes the complete attempt when it fits and marks a smaller Unicode-safe preview only when necessary", () => {
  const proposal = JSON.stringify({
    kind: "agreement",
    description: "😀".repeat(3000),
  });
  const input = {
    input: { context: { components: [] }, examples: [] },
    evidence: {
      repair: {
        check: "builder_response",
        message: "Missing description",
        proposal: { text: proposal, truncated: false },
      },
    },
  };
  const complete = authoringMessages("Trusted instructions", input, 64000);
  assert.equal(complete[2].content, proposal);
  assert.equal(JSON.parse(complete[3].content).proposalComplete, true);
  const smaller = authoringMessages("Trusted instructions", input, 8192);
  assert.ok(Buffer.byteLength(JSON.stringify(smaller)) <= 8192);
  const preview = JSON.parse(smaller[1].content).evidence.repair.proposal;
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.includes("\ufffd"), false);
  assert.equal(smaller.length, 3);
  assert.equal(JSON.parse(smaller[2].content).proposalComplete, false);
  assert.equal(input.evidence.repair.proposal.text, proposal);
  assert.equal(input.evidence.repair.proposal.truncated, false);
});
