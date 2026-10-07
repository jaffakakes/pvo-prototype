import assert from "node:assert/strict";
import test from "node:test";
import {
  newBuilderState,
  parseBuilderState,
  acceptBuilderDecision,
  builderStage,
  beginBuilderBatch,
  nextBuilderTool,
  recordBuilderTool,
  interruptBuilderBatch,
  builderContext,
} from "../../packages/pvo-assistant/builder/index.js";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
const digest = "a".repeat(64);
const agreed = () =>
  acceptBuilderDecision(
    newBuilderState(),
    { kind: "agreement", agreement: dinnerAgreement() },
    digest,
  );
const tools = (calls, review = null) => ({ kind: "tools", calls, review });
const review = {
  kind: "review",
  libraries: [],
  revision: 1,
  digest,
  entrypoint: "src/service.mjs",
  tests: ["tests/service.test.mjs"],
};

test("saved builder freezes agreement, assigns stable tool positions and accepts only current batch feedback", () => {
  let state = agreed();
  assert.equal(builderStage(state), "model");
  assert.throws(() =>
    acceptBuilderDecision(
      state,
      { kind: "agreement", agreement: dinnerAgreement() },
      digest,
    ),
  );
  state = acceptBuilderDecision(
    state,
    tools([{ kind: "workspace_list" }, { kind: "workspace_list" }]),
  );
  assert.equal(builderStage(state), "tools");
  assert.throws(() => acceptBuilderDecision(state, review));
  assert.throws(() => recordBuilderTool(state, nextBuilderTool(state), {}));
  state = beginBuilderBatch(state, 7);
  const first = nextBuilderTool(state);
  assert.equal(first.operationId, "build-2-0");
  assert.throws(() => beginBuilderBatch(state, 8));
  state = recordBuilderTool(state, first, { revision: 0 });
  assert.throws(() => recordBuilderTool(state, first, { revision: 0 }));
  assert.deepEqual(parseBuilderState(JSON.parse(JSON.stringify(state))), state);
  state = recordBuilderTool(state, nextBuilderTool(state), { revision: 1 });
  assert.equal(builderStage(state), "model");
  assert.equal(state.batchEnd, "completed");
  assert.equal(state.feedback.length, 2);
  assert.deepEqual(state.agreement, agreed().agreement);
});

test("a failed or abandoned batch cannot use its conditional review request", () => {
  const batch = () =>
    beginBuilderBatch(
      acceptBuilderDecision(
        agreed(),
        tools([{ kind: "workspace_list" }], review),
      ),
      3,
    );
  const state = batch();
  const success = recordBuilderTool(state, nextBuilderTool(state), {
    revision: 1,
  });
  assert.equal(builderStage(success), "review");
  const failure = recordBuilderTool(
    state,
    nextBuilderTool(state),
    { status: "interrupted" },
    true,
  );
  assert.equal(builderStage(failure), "model");
  assert.equal(failure.batchEnd, "failed");
  assert.equal(builderStage(interruptBuilderBatch(state)), "model");
  assert.throws(() => parseBuilderState({ ...state, cursor: 1 }));
  assert.throws(() =>
    parseBuilderState({ ...state, feedback: [{ kind: "deploy", result: {} }] }),
  );
});

test("builder feedback stays bounded while the saved decision retains full source", () => {
  let state = agreed();
  const decision = tools([
    {
      kind: "workspace_write",
      expectedRevision: 0,
      files: [{ path: "src/service.mjs", content: "x".repeat(90000) }],
    },
  ]);
  state = acceptBuilderDecision(state, decision);
  const context = builderContext(state);
  assert.equal(context.lastDecision.contentOmitted, true);
  assert.equal(context.lastDecision.calls[0].files[0].bytes, 90000);
  assert.equal(state.decision.calls[0].files[0].content.length, 90000);
  for (let index = 0; index < 3; index++) {
    state = beginBuilderBatch(state, index + 1);
    state = recordBuilderTool(state, nextBuilderTool(state), {
      stdout: "\u0000".repeat(16384),
    });
    if (index < 2)
      state = acceptBuilderDecision(state, tools([{ kind: "workspace_list" }]));
  }
  assert.equal(state.feedback.length, 1);
  assert.equal(state.omittedFeedback, 2);
  assert.ok(JSON.stringify(builderContext(state)).length < 150000);
});

test("100 tool results retain the agreement and current cursor with bounded recent context", () => {
  let state = agreed();
  const agreement = structuredClone(state.agreement);
  for (let index = 0; index < 100; index++) {
    state = acceptBuilderDecision(state, tools([{ kind: "workspace_list" }]));
    state = beginBuilderBatch(state, index + 1);
    state = recordBuilderTool(state, nextBuilderTool(state), {
      revision: index,
    });
    state = parseBuilderState(JSON.parse(JSON.stringify(state)));
  }
  assert.equal(state.feedback.length, 24);
  assert.equal(state.omittedFeedback, 76);
  assert.equal(state.feedback[0].result.revision, 76);
  assert.equal(state.feedback.at(-1).result.revision, 99);
  assert.equal(state.round, 101);
  assert.equal(state.cursor, 1);
  assert.equal(builderStage(state), "model");
  assert.deepEqual(state.agreement, agreement);
});
