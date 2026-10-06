import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exerciseAuthoring } from "../../scripts/checks/cloud-agent-first-release/exercise.mjs";
import { reviewedAnswer } from "../../scripts/checks/cloud-agent-first-release/review-inputs.mjs";

test("a second creator question waits for review and continues the same saved task", async () => {
  let answerCount = 0,
    requestedReview,
    releaseReview;
  const reviewing = new Promise((resolve) => {
    requestedReview = resolve;
  });
  const reviewed = new Promise((resolve) => {
    releaseReview = resolve;
  });
  const submitted = [],
    checkpoints = [],
    deliveries = [];
  const snapshot = (subject) => ({
    task: {
      id: subject,
      revision: answerCount,
      state:
        subject === "dinner" && answerCount < 2
          ? "waiting_for_answer"
          : "ready",
      questions:
        subject === "dinner" && answerCount < 2
          ? [{ id: `q-${answerCount}`, revision: 0, answer: null }]
          : [],
    },
    result: {},
    services: [{}],
    workspaces: [{ absent: true }],
  });
  const call = async (path, method, body) => {
    const [, subject, operation] = path.split("/");
    if (operation === "command") {
      submitted.push(body);
      answerCount++;
    }
    return { status: 200, data: snapshot(subject) };
  };
  const running = exerciseAuthoring(
    call,
    async (subject, value) => checkpoints.push(value.task),
    {
      expiresAt: Date.now() + 10000,
      pollMs: 1,
      answerQuestion: async (subject, question, current, answers) => {
        if (answers === 0) return "Two seats";
        requestedReview();
        return reviewed;
      },
      onReady: async (subject) => deliveries.push(subject),
    },
  );
  await reviewing;
  assert.equal(answerCount, 1);
  assert.deepEqual(deliveries, []);
  releaseReview("Use exactly two seats, as already specified");
  await running;
  assert.deepEqual(deliveries, ["dinner", "equipment"]);
  assert.deepEqual(
    submitted.map((value) => value.id),
    ["dinner", "dinner"],
  );
  assert.notEqual(
    submitted[0].input.operationId,
    submitted[1].input.operationId,
  );
  assert.equal(
    submitted[1].input.value,
    "Use exactly two seats, as already specified",
  );
});

test("local reviewed answers reject a stale task or question identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "restyle-reviewed-answer-"));
  const file = join(directory, "answer.json");
  const question = { id: "question-2", revision: 0 };
  const options = {
    taskId: "saved-task",
    question,
    expiresAt: Date.now() + 10000,
    signal: new AbortController().signal,
  };
  try {
    await writeFile(
      file,
      JSON.stringify({
        taskId: "different-task",
        questionId: question.id,
        questionRevision: 0,
        value: "Two seats",
      }),
    );
    await assert.rejects(reviewedAnswer(file, options));
    await writeFile(
      file,
      JSON.stringify({
        taskId: options.taskId,
        questionId: question.id,
        questionRevision: 0,
        value: "Two seats",
      }),
    );
    assert.equal(await reviewedAnswer(file, options), "Two seats");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("camera-only acceptance resumes an interrupted inference and recovers a worker restart on the same task", async () => {
  let phase = "interrupted",
    reads = 0;
  const effects = [],
    checks = [];
  const current = () => ({
    task: {
      id: "saved-camera",
      revision: phase === "interrupted" ? 4 : 8,
      state:
        phase === "interrupted"
          ? "failed"
          : phase === "restarted"
            ? "ready"
            : "running",
      stepId: "build",
      failure: phase === "interrupted" ? { code: "interrupted" } : null,
      questions: [],
    },
    build: {
      agreement: { digest: "same-agreement" },
      feedback: [{ kind: "workspace_write", result: { status: "completed" } }],
    },
    result: {},
    services: [{}],
    workspaces: [{ absent: true }],
  });
  await exerciseAuthoring(
    async (path, method, body) => {
      assert.ok(path.startsWith("/equipment/"));
      if (path.endsWith("/begin")) return { status: 200, data: current() };
      if (path.endsWith("/command")) {
        assert.equal(body.kind, "resume");
        assert.equal(body.id, "saved-camera");
        assert.equal(body.input.expectedRevision, 4);
        effects.push("resume");
        phase = "building";
        // Resume committed, but its reply was lost. A fresh read must precede further effects.
        throw new Error("lost reply");
      }
      if (path.endsWith("/restart")) {
        assert.ok(reads >= 2);
        effects.push("restart");
        phase = "restarted";
        return { status: 503, data: {} };
      }
      reads++;
      return { status: 200, data: current() };
    },
    async () => {},
    {
      subjects: ["equipment"],
      restartAfterSource: true,
      expiresAt: Date.now() + 10000,
      pollMs: 1,
      record: async (check) => checks.push(check),
    },
  );
  assert.deepEqual(effects, ["resume", "restart"]);
  assert.ok(checks.includes("authoring_restarted_during_build"));
});

for (const state of ["stopped", "failed"]) {
  test(`acceptance does not automatically revive ${state} work without a retryable inference failure`, async () => {
    const snapshot = {
      task: {
        id: "camera",
        state,
        revision: 1,
        questions: [],
        failure: { code: "invalid_result" },
      },
    };
    await assert.rejects(
      exerciseAuthoring(
        async (path) => {
          assert.ok(!path.endsWith("/command"));
          return { status: 200, data: snapshot };
        },
        async () => {},
        { subjects: ["equipment"], expiresAt: Date.now() + 1000 },
      ),
      new RegExp(`task ${state}`),
    );
  });
}
