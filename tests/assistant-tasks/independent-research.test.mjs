import assert from "node:assert/strict";
import test from "node:test";
import {
  create,
  claim,
  command,
  question,
  answer,
  result,
  now,
} from "./fixtures.mjs";

function queuedResearch() {
  let task = command(claim(create()), { kind: "checkpoint", stepId: "build" });
  return command(claim(task), { kind: "ask_research", question: question() });
}

test("a saved question can coexist with independent research and an early answer preserves its claim", () => {
  let task = claim(queuedResearch());
  const lease = structuredClone(task.claim),
    generation = task.generation;
  task = command(task, answer(), { claim: null });
  assert.equal(task.state, "running");
  assert.deepEqual(task.claim, lease);
  assert.equal(task.generation, generation);
  assert.equal(task.questions[0].answer.value, "Friday");
  assert.deepEqual(command(task, answer(), { claim: null }), task);
  task = command(task, { kind: "checkpoint", stepId: "build" });
  assert.equal(task.state, "queued");
});

test("unanswered research finishes waiting, survives recovery/Stop and cannot advance to hosting", () => {
  const queued = queuedResearch();
  let task = claim(queued);
  assert.throws(
    () => command(task, { kind: "checkpoint", stepId: "host" }),
    /pending question/,
  );
  assert.throws(
    () => command(task, { kind: "complete", result: result() }),
    /Unanswered/,
  );
  assert.throws(
    () =>
      command(task, {
        kind: "ask_research",
        question: { ...question(), id: "another" },
      }),
    /Unanswered/,
  );
  task = command(task, { kind: "checkpoint", stepId: "build" });
  assert.equal(task.state, "waiting_for_answer");
  assert.equal(command(task, answer()).state, "queued");
  task = claim(queued);
  task = command(task, { kind: "recover" }, { claim: null, now: now + 120000 });
  assert.equal(task.questions[0].answer, null);
  task = command(task, { kind: "stop" }, { claim: null });
  assert.equal(task.state, "stopped");
  assert.equal(task.questions[0].prompt, "Which day?");
  assert.throws(() => command(task, answer()), /terminal/);
});
