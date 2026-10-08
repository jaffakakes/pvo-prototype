import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { taskFixture, saved, path, expectStatus } from "./helpers.mjs";

const history = (changes = {}) => ({
  kind: "history",
  collection: "questions",
  after: 0,
  offset: 0,
  notes: "Question 0 contains the original booking preference.",
  ...changes,
});
const current = async (f, task) => (await f.request(path(task))).body.task;
const step = async (f, task, command) => {
  const result = await f.control({ action: "step", id: task.id, command });
  expectStatus(result, 200);
  return result.body;
};
const claim = (f, task, index) =>
  step(f, task, {
    kind: "claim",
    claimId: `question-worker-${index}`,
    leaseMs: 60000,
  });
const question = (index) => ({
  id: `question-${index}`,
  revision: 0,
  prompt:
    index === 0 ? "Booking preference " + "🎈".repeat(480) : `Detail ${index}?`,
  choices: [],
  answer: null,
});
const answer = (index) => ({
  questionId: `question-${index}`,
  questionRevision: 0,
  operationId: `answer-${index}`,
  value:
    index === 0 ? "Original preference " + "💙".repeat(990) : `Answer ${index}`,
});
async function seed(f, unanswered = false) {
  expectStatus(await f.control({ action: "pause-planning" }), 200);
  let task = await saved(f);
  for (let index = 0; index < 40; index++) {
    task = await claim(f, task, index);
    task = await step(f, task, { kind: "ask", question: question(index) });
    if (unanswered && index === 39) break;
    task = await step(f, task, { kind: "answer", ...answer(index) });
  }
  return task;
}
async function select(f, task, request) {
  const result = await f.control({
    action: "select-evidence",
    id: task.id,
    request,
  });
  expectStatus(result, 200);
  return result.body;
}
async function until(read, predicate) {
  for (let end = Date.now() + 10000; Date.now() < end;) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail("Saved evidence did not reach the expected state.");
}

test("40 answers survive owned archive/restart, bounded Unicode retrieval and exact replay without identity reuse", async () => {
  const f = await taskFixture();
  try {
    let task = await seed(f);
    assert.equal(task.archivedQuestions + task.questions.length, 40);
    assert.ok(task.questions.length <= 9);
    assert.ok(task.archivedQuestions > 0);
    let request = history(),
      content = "",
      first;
    do {
      const page = await select(f, task, request);
      first ??= page;
      assert.ok(new TextEncoder().encode(page.content).length <= 4096);
      content += page.content;
      request =
        page.nextOffset === null ? null : history({ offset: page.nextOffset });
    } while (request);
    assert.deepEqual(JSON.parse(content), {
      ...question(0),
      revision: 1,
      answer: {
        operationId: "answer-0",
        value: answer(0).value,
        answeredAt: task.createdAt,
      },
    });
    assert.ok(first.nextOffset > 0);
    await f.restart();
    assert.deepEqual(await current(f, task), task);
    assert.deepEqual(await select(f, task, history()), first);
    assert.deepEqual(
      await step(f, task, { kind: "answer", ...answer(0) }),
      task,
    );
    for (const command of [
      { kind: "answer", ...answer(0), value: "Changed" },
      { kind: "answer", ...answer(39), operationId: "answer-0" },
    ])
      expectStatus(
        await f.control({ action: "step", id: task.id, command }),
        409,
      );
    expectStatus(await f.request(path(task), { session: f.otherCookie }), 404);
    expectStatus(
      await f.request("/__test", {
        session: f.otherCookie,
        body: { action: "select-evidence", id: task.id, request: history() },
      }),
      409,
    );
    task = await claim(f, task, "after-restart");
    expectStatus(
      await f.control({
        action: "step",
        id: task.id,
        command: {
          kind: "record_operation",
          operation: {
            id: "answer-0",
            stepId: task.stepId,
            inputDigest: "a".repeat(64),
            status: "planned",
            resources: [],
            artifact: null,
            failure: null,
            createdAt: task.updatedAt,
            updatedAt: task.updatedAt,
          },
        },
      }),
      409,
    );
    expectStatus(
      await f.control({
        action: "step",
        id: task.id,
        command: { kind: "ask", question: question(0) },
      }),
      409,
    );
    assert.deepEqual(await current(f, task), task);
    task = await step(f, task, { kind: "ask", question: question(40) });
    expectStatus(
      await f.control({ action: "history-write-failure", enabled: true }),
      200,
    );
    expectStatus(
      await f.control({
        action: "step",
        id: task.id,
        command: { kind: "answer", ...answer(40) },
      }),
      409,
    );
    assert.deepEqual(
      await current(f, task),
      task,
      "A failed archive cannot consume the pending answer",
    );
    expectStatus(
      await f.control({ action: "history-write-failure", enabled: false }),
      200,
    );
    task = await step(f, task, { kind: "answer", ...answer(40) });
    assert.equal(task.archivedQuestions + task.questions.length, 41);
  } finally {
    await f.close();
  }
});

test("planning retrieves archived answer fragments after full restart and carries saved working notes into its next decision", async () => {
  const selections = [];
  const f = await taskFixture({
    planner: async (request) => {
      const task = await request.json();
      const selection = task.evidenceContext.selection;
      if (!selection) return Response.json(history());
      selections.push(selection);
      assert.equal(selection.notes, history().notes);
      if (selection.nextOffset !== null)
        return Response.json(history({ offset: selection.nextOffset }));
      return Response.json({
        kind: "ask",
        question: {
          id: "clarification",
          revision: 0,
          prompt: "Confirm the saved preference?",
          choices: [],
          answer: null,
        },
      });
    },
  });
  try {
    let task = await seed(f, true);
    await f.restart();
    const result = await f.request(path(task) + "/answers", {
      body: { expectedRevision: task.revision, ...answer(39) },
    });
    expectStatus(result, 200);
    task = await until(
      () => current(f, task),
      (value) =>
        value.state === "waiting_for_answer" &&
        value.questions.at(-1).id === "clarification",
    );
    assert.equal(
      JSON.parse(selections.map((item) => item.content).join("")).answer.value,
      answer(0).value,
    );
    assert.ok(selections.length > 1);
    assert.equal(task.usage.modelTurns, selections.length + 1);
    assert.equal(
      task.usage.toolCalls,
      0,
      "Selecting saved context performs no external work",
    );
    const before = await current(f, task);
    await f.restart();
    assert.deepEqual(await current(f, task), before);
  } finally {
    await f.close();
  }
});

test("Stop rejects a late history selection and its working notes", async () => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const f = await taskFixture({
    planner: async () => {
      entered();
      await held;
      return Response.json(history({ collection: "operations" }));
    },
  });
  try {
    let task = await saved(f);
    await started;
    task = await current(f, task);
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: task.revision },
      }),
      200,
    );
    release();
    task = await until(
      () => current(f, task),
      (value) =>
        value.state === "stopped" && value.usage.reservedModelTurns === 0,
    );
    const evidence = await f.control({
      action: "evidence-context",
      id: task.id,
    });
    expectStatus(evidence, 200);
    assert.equal(evidence.body.selection, null);
    assert.equal(task.usage.modelTurns, 1);
  } finally {
    release();
    await f.close();
  }
});
