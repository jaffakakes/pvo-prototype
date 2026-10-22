import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  entryPoints: ["editor/src/domain/assistant/buildDiagnostics.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { parseBuildDiagnostic } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const reference = { ownerId: "owner", projectId: "project", taskId: "task" };
const diagnostic = () => ({
  reference,
  stepId: "build",
  review: null,
  repair: {
    check: "builder_response",
    message: "A required field is missing.",
    repetitions: 3,
    proposal: { text: "<script>untrusted()</script>", truncated: false },
  },
});

test("build diagnostics require the exact account, project and task before exposing private text", () => {
  for (const field of ["ownerId", "projectId", "taskId"])
    assert.throws(() =>
      parseBuildDiagnostic(
        { ...diagnostic(), reference: { ...reference, [field]: "other" } },
        reference,
      ),
    );
  const value = diagnostic();
  assert.equal(
    parseBuildDiagnostic(value, reference).repair.proposal.text,
    value.repair.proposal.text,
  );
  assert.deepEqual(
    parseBuildDiagnostic({ ...value, repair: null }, reference),
    { stepId: "build", repair: null, review: null },
  );
});

test("malformed and oversized build details are rejected before rendering", () => {
  for (const mutate of [
    (value) => (value.repair.repetitions = "3"),
    (value) => (value.repair.repetitions = 0),
    (value) => (value.repair.message = "😀".repeat(513)),
    (value) => (value.repair.proposal.text = "😀".repeat(32769)),
    (value) => (value.repair.proposal.truncated = "false"),
    (value) => (value.repair = []),
  ]) {
    const value = diagnostic();
    mutate(value);
    assert.throws(() => parseBuildDiagnostic(value, reference));
  }
});

test("independent check diagnostics preserve exact source and failure detail without accepting malformed report metadata", () => {
  const value = {
    ...diagnostic(),
    repair: null,
    review: {
      revision: 2,
      digest: "a".repeat(64),
      status: "failed",
      caseId: "send-once",
      step: 1,
      detail: "reply.accepted: expected true, received false.",
    },
  };
  assert.deepEqual(parseBuildDiagnostic(value, reference).review, value.review);
  for (const mutate of [
    (v) => {
      delete v.review;
    },
    (v) => {
      v.review.revision = 0;
    },
    (v) => {
      v.review.digest = "not-saved-source";
    },
    (v) => {
      v.review.status = "invented-success";
    },
    (v) => {
      v.review.step = null;
    },
    (v) => {
      v.review.step = -1;
    },
    (v) => {
      v.review.caseId = "<script>";
    },
    (v) => {
      v.review.detail = "😀".repeat(513);
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => parseBuildDiagnostic(changed, reference));
  }
  value.review = {
    ...value.review,
    status: "artifact_error",
    caseId: null,
    step: null,
    detail: "Review source does not match its exact saved bytes.",
  };
  assert.deepEqual(parseBuildDiagnostic(value, reference).review, value.review);
});
