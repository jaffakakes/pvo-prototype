import assert from "node:assert/strict";
import test from "node:test";
import {
  create,
  command,
  claim,
  result,
  question,
  answer,
} from "./fixtures.mjs";
import {
  alternative,
  manualQuestion,
  manualAnswer,
  resolution,
} from "./manual.fixture.mjs";
import {
  parseManualAlternative,
  parseTaskRecord,
  hasPendingManualSteps,
  TASK_LIMITS,
  DECLINE_ALTERNATIVE,
} from "../../packages/pvo-assistant/tasks/index.js";
import {
  parseBuilderDecision,
  builderDecisionSchema,
} from "../../packages/pvo-assistant/builder/index.js";
const pending = () =>
  command(claim(create()), { kind: "ask", question: manualQuestion() });
const chosen = () => command(pending(), manualAnswer());

test("only explicit choice accepts the shown plan; rejection/free text leave original request intact", () => {
  for (const value of [
    DECLINE_ALTERNATIVE,
    "Actually, I only need a draft email",
  ]) {
    const task = command(pending(), manualAnswer(value));
    assert.deepEqual(task.manualPlans, []);
    assert.equal(task.input.request, create().input.request);
  }
  const task = chosen();
  assert.equal(
    task.manualPlans[0].proposal.preparedOutcome,
    alternative().preparedOutcome,
  );
  assert.equal(task.manualPlans[0].steps[0].resolution, null);
  assert.deepEqual(command(task, manualAnswer()), task);
  assert.throws(
    () => command(task, manualAnswer("Changed promise")),
    /conflicts/,
  );
});

test("component readiness and weeks offline cannot resolve or expire manual follow-up; only a creator result does", () => {
  let task = command(claim(chosen()), { kind: "complete", result: result() });
  assert.equal(task.state, "ready");
  assert.equal(task.expiresAt, null);
  assert.equal(task.finishedAt, null);
  assert.equal(hasPendingManualSteps(task), true);
  task = parseTaskRecord(JSON.parse(JSON.stringify(task)));
  const now = task.updatedAt + 40 * 86400000;
  for (const options of [
    { ownerId: "other" },
    { expectedRevision: task.revision - 1 },
    { claim: { id: "forged", generation: task.generation } },
  ])
    assert.throws(() => command(task, resolution(), { now, ...options }));
  const completed = command(task, resolution(), { now });
  assert.equal(completed.expiresAt, now + TASK_LIMITS.retentionMs);
  assert.equal(
    completed.manualPlans[0].steps[0].resolution.status,
    "completed",
  );
  assert.deepEqual(command(completed, resolution()), completed);
  assert.throws(
    () => command(completed, resolution({ note: "Different" })),
    /conflicts/,
  );
  assert.throws(
    () => command(completed, resolution({ operationId: "again" })),
    /already resolved/,
  );
});

test("stopping AI work preserves human obligations; cancellation records abandonment without claiming completion", () => {
  const stopped = command(chosen(), { kind: "stop" });
  assert.equal(stopped.expiresAt, null);
  const cancelled = command(
    stopped,
    resolution({ status: "cancelled", note: "The event was cancelled." }),
  );
  assert.equal(cancelled.state, "stopped");
  assert.equal(
    cancelled.manualPlans[0].steps[0].resolution.status,
    "cancelled",
  );
  assert.ok(cancelled.expiresAt);
});

test("archiving many questions preserves the accepted outcome and pending human steps in the same task", () => {
  let task = chosen();
  for (let index = 0; index < 24; index++) {
    const id = `followup-${index}`;
    task = command(claim(task), {
      kind: "ask",
      question: { ...question(), id },
    });
    task = command(task, {
      ...answer(),
      questionId: id,
      operationId: `answer-${index}`,
    });
  }
  assert.ok(task.archivedQuestions > 0);
  assert.ok(!task.questions.some((item) => item.id === "manual-choice"));
  assert.equal(task.manualPlans[0].proposal.originalOutcome, "Reserve a table");
  assert.equal(hasPendingManualSteps(task), true);
});

test("closed proposal and builder stage reject invented authority, duplicate fields and changes after the frozen agreement", () => {
  for (const proposal of [
    alternative({ completed: true }),
    alternative({ fields: [alternative().fields[0], alternative().fields[0]] }),
    alternative({ steps: [] }),
  ])
    assert.throws(() => parseManualAlternative(proposal));
  const decision = { kind: "manual_alternative", proposal: alternative() };
  assert.deepEqual(
    parseBuilderDecision(decision, { hasAgreement: false, available: [] }),
    decision,
  );
  assert.throws(() =>
    parseBuilderDecision(decision, { hasAgreement: true, available: [] }),
  );
  assert.ok(
    builderDecisionSchema(false, []).anyOf.some(
      (item) => item.properties.kind.const === "manual_alternative",
    ),
  );
  assert.ok(
    !builderDecisionSchema(true, []).anyOf.some(
      (item) => item.properties.kind.const === "manual_alternative",
    ),
  );
});
