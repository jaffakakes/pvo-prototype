import assert from "node:assert/strict";
import test from "node:test";
import { authoringMessages } from "../../server/assistant/tasks/promptContext.js";

const review = {
  kind: "review",
  revision: 1,
  digest: "a".repeat(64),
  entrypoint: "src/index.mjs",
  tests: ["tests/index.test.mjs"],
  libraries: [],
};
function context() {
  return {
    input: { context: { components: [] }, examples: [] },
    build: {
      round: 44,
      lastDecision: {
        kind: "tools",
        calls: [{ kind: "workspace_test" }],
        review,
      },
      batchEnd: "completed",
      feedback: [
        {
          operationId: "build-44-0",
          result: { exitCode: 0, stdout: "All generated tests pass" },
        },
      ],
      reviewFeedback: {
        review,
        error: null,
        report: {
          status: "failed",
          cases: [
            {
              id: "success",
              failure: {
                step: 0,
                code: "invalid_reply",
                detail: "Invalid account request shape",
              },
            },
          ],
        },
      },
    },
  };
}
const messages = (input, maximum = 8192) =>
  authoringMessages("Trusted instructions", input, maximum);
const latest = (input) => JSON.parse(messages(input).at(-1).content);

test("independent review supersedes passing generated tests for bundled and standalone decisions", () => {
  for (const standalone of [false, true]) {
    for (const status of ["failed", "passed", "artifact_error"]) {
      const input = context();
      if (standalone) input.build.lastDecision = review;
      if (status === "artifact_error") {
        input.build.reviewFeedback.report = null;
        input.build.reviewFeedback.error = "Saved source digest changed";
      } else input.build.reviewFeedback.report.status = status;
      const before = structuredClone(input);
      const result = latest(input);
      assert.deepEqual(result.observed, {
        independentReview: input.build.reviewFeedback,
      });
      assert.match(result.nextAction, /change the implementation/);
      assert.match(result.nextAction, /exact saved source/);
      assert.deepEqual(input, before);
    }
  }
});

test("pending or unrelated tools cannot present a retained review as their current result", () => {
  for (const batchEnd of [null, "failed", "completed"]) {
    const input = context();
    input.build.batchEnd = batchEnd;
    if (batchEnd === "completed") input.build.lastDecision.review = null;
    assert.equal(latest(input).observed?.independentReview, undefined);
  }
});

test("review identity and failure survive source-decision projection and bounded prompt compaction", () => {
  const input = context();
  input.build.lastDecision.contentOmitted = true;
  const result = latest(input);
  assert.deepEqual(
    result.observed.independentReview,
    input.build.reviewFeedback,
  );
  assert.equal(messages(input).length, 3);

  delete input.build.lastDecision.contentOmitted;
  input.build.lastDecision.calls = [
    { kind: "workspace_write", files: [{ content: "x".repeat(90000) }] },
  ];
  const compact = messages(input, 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 4096);
  assert.deepEqual(
    JSON.parse(compact.at(-1).content).observed.independentReview,
    input.build.reviewFeedback,
  );

  input.build.reviewFeedback.report.cases[0].failure.detail = "x".repeat(90000);
  const omitted = messages(input, 4096);
  const projected = JSON.parse(omitted.at(-1).content).observed
    .independentReview;
  assert.equal(projected.contentOmitted, true);
  assert.equal(projected.historyCollection, "reviews");
  assert.equal(projected.status, "failed");
  assert.deepEqual(projected.review, review);
  assert.ok(Buffer.byteLength(JSON.stringify(omitted)) <= 4096);
});
