import assert from "node:assert/strict";
import test from "node:test";
import {
  newServiceTestReport,
  appendServiceCaseResult,
  parseServiceTestReport,
  inspectServiceReply,
  serializeServiceAgreement,
  serializeServiceFiles,
} from "../../packages/pvo-assistant/services/index.js";
import {
  newBuilderState,
  acceptBuilderDecision,
} from "../../packages/pvo-assistant/builder/index.js";
import { prepareServiceArtifact } from "../../server/assistant/validation/artifact.js";
import { contentDigest } from "../../server/contentDigest.js";
import {
  dinnerAgreement,
  equipmentAgreement,
  identity,
  packageFor,
} from "./fixtures.mjs";

test("a report binds exact agreement/package/source bytes and cannot skip cases or claim incomplete success", () => {
  const agreement = dinnerAgreement();
  agreement.cases.push({ ...structuredClone(agreement.cases[0]), id: "again" });
  const key = identity(),
    initial = newServiceTestReport(agreement, key);
  const result = {
    id: "capacity",
    status: "passed",
    completedSteps: 4,
    failure: null,
  };
  const first = appendServiceCaseResult(initial, agreement, key, result);
  assert.equal(first.status, "running");
  assert.throws(() =>
    parseServiceTestReport({ ...first, status: "passed" }, agreement, key),
  );
  assert.throws(() =>
    appendServiceCaseResult(initial, agreement, key, {
      ...result,
      completedSteps: 3,
    }),
  );
  assert.throws(() =>
    appendServiceCaseResult(initial, agreement, key, {
      ...result,
      id: "again",
    }),
  );
  assert.throws(() =>
    parseServiceTestReport(first, agreement, {
      ...key,
      packageDigest: "d".repeat(64),
    }),
  );
  const final = appendServiceCaseResult(first, agreement, key, {
    ...result,
    id: "again",
  });
  assert.equal(final.status, "passed");
  assert.throws(() => appendServiceCaseResult(final, agreement, key, result));
  assert.throws(() =>
    parseServiceTestReport(
      { ...final, generatedApproval: true },
      agreement,
      key,
    ),
  );
});

test("trusted comparison checks actual values, schema and read-only state instead of generated pass messages", () => {
  const agreement = dinnerAgreement(),
    scenario = agreement.cases[0],
    step = scenario.steps[0];
  const invocation = {
    operation: step.operation,
    input: step.input,
    state: scenario.initialState,
    now: step.now,
  };
  assert.equal(
    inspectServiceReply(agreement, invocation, step.expected, step.expected),
    null,
  );
  assert.equal(
    inspectServiceReply(agreement, invocation, step.expected, {
      ...step.expected,
      result: "full",
    }).code,
    "mismatch",
  );
  assert.equal(
    inspectServiceReply(agreement, invocation, step.expected, { passed: true })
      .code,
    "invalid_reply",
  );
  const last = scenario.steps.at(-1);
  assert.equal(
    inspectServiceReply(
      agreement,
      { ...last, state: last.expected.state },
      last.expected,
      { result: ["Alice"], state: { capacity: 2, guests: ["Alice"] } },
    ).code,
    "invalid_reply",
  );
});

test("artifact preparation verifies frozen agreement and exact saved revision/files before constructing a package", async () => {
  const agreement = dinnerAgreement(),
    files = packageFor().files;
  const agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  const sourceDigest = await contentDigest(serializeServiceFiles(files));
  let builder = acceptBuilderDecision(
    newBuilderState(),
    { kind: "agreement", agreement },
    agreementDigest,
  );
  builder = acceptBuilderDecision(builder, {
    kind: "review",
    libraries: [],
    revision: 1,
    digest: sourceDigest,
    entrypoint: "src/service.mjs",
    tests: ["tests/service.test.mjs"],
  });
  const snapshot = { revision: 1, digest: sourceDigest, files };
  const artifact = await prepareServiceArtifact(builder, snapshot);
  assert.equal(artifact.identity.agreementDigest, agreementDigest);
  assert.equal(artifact.identity.sourceDigest, sourceDigest);
  assert.match(artifact.identity.packageDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(artifact.package.dependencies, []);
  const withLibrary = structuredClone(builder);
  withLibrary.decision.libraries = ["nanoid@5.1.6"];
  const locked = await prepareServiceArtifact(withLibrary, snapshot);
  assert.equal(locked.identity.sourceDigest, artifact.identity.sourceDigest);
  assert.notEqual(
    locked.identity.packageDigest,
    artifact.identity.packageDigest,
  );
  assert.equal(locked.package.dependencies[0].version, "5.1.6");

  for (const change of [
    (value) => {
      value.revision = 2;
    },
    (value) => {
      value.digest = "d".repeat(64);
    },
    (value) => {
      value.files[0].content += "\n// tampered";
    },
  ]) {
    const value = structuredClone(snapshot);
    change(value);
    await assert.rejects(prepareServiceArtifact(builder, value));
  }
  const changed = structuredClone(builder);
  changed.agreement.body = equipmentAgreement();
  await assert.rejects(prepareServiceArtifact(changed, snapshot));
});

test("review failures allow repair with the same agreement, while pending or mismatched reports cannot approve it", async () => {
  const {
    recordBuilderReview,
    builderStage,
    builderContext,
    parseBuilderDecision,
  } = await import("../../packages/pvo-assistant/builder/index.js");
  const agreement = dinnerAgreement(),
    key = identity();
  let state = acceptBuilderDecision(
    newBuilderState(),
    { kind: "agreement", agreement },
    key.agreementDigest,
  );
  const review = {
    kind: "review",
    libraries: [],
    revision: 1,
    digest: key.sourceDigest,
    entrypoint: "src/service.mjs",
    tests: ["tests/service.test.mjs"],
  };
  state = acceptBuilderDecision(state, review);
  const initial = newServiceTestReport(agreement, key);
  assert.throws(() =>
    recordBuilderReview(state, { review, report: initial, error: null }),
  );
  const report = appendServiceCaseResult(initial, agreement, key, {
    id: "capacity",
    status: "failed",
    completedSteps: 0,
    failure: {
      step: 0,
      code: "mismatch",
      detail: "Expected accepted, received full.",
    },
  });
  assert.throws(() =>
    recordBuilderReview(state, {
      review: { ...review, digest: "d".repeat(64) },
      report,
      error: null,
    }),
  );
  assert.throws(() =>
    recordBuilderReview(state, {
      review: { ...review, libraries: ["nanoid@5.1.6"] },
      report,
      error: null,
    }),
  );
  state = recordBuilderReview(state, { review, report, error: null });
  assert.equal(builderStage(state), "model");
  assert.equal(builderContext(state).reviewFeedback.report.status, "failed");
  assert.throws(() =>
    acceptBuilderDecision(
      state,
      { kind: "agreement", agreement },
      key.agreementDigest,
    ),
  );
  assert.throws(() =>
    parseBuilderDecision(
      { ...review, passed: true },
      { hasAgreement: true, available: [] },
    ),
  );
  const again = acceptBuilderDecision(state, review);
  assert.equal(again.reviewFeedback, null);
  assert.equal(builderStage(again), "review");
  const complete = appendServiceCaseResult(initial, agreement, key, {
    id: "capacity",
    status: "passed",
    completedSteps: 4,
    failure: null,
  });
  const checked = recordBuilderReview(again, {
    review,
    report: complete,
    error: null,
  });
  assert.equal(builderStage(checked), "review");
  assert.throws(() =>
    acceptBuilderDecision(checked, {
      kind: "ask",
      prompt: "Change the tests?",
      choices: [],
    }),
  );
});
