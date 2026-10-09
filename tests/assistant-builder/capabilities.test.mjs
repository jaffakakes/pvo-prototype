import { alternative } from "../assistant-tasks/manual.fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBuilderResearch,
  serializeBuilderResearch,
  parseBuilderResearchResult,
  builderResearchDefinitions,
  parseBuilderDecision,
  builderDecisionSchema,
  createResearchEvidence,
  createCapabilityDecision,
} from "../../packages/pvo-assistant/builder/index.js";
import { parseConnectionMetadata } from "../../packages/pvo-assistant/connections/index.js";
import { evidenceNote, evidencePage } from "./research-evidence.fixture.mjs";
import {
  decision,
  connection,
} from "../assistant-task-server/capability-research.helpers.mjs";
import { question } from "../assistant-tasks/fixtures.mjs";

const hash = "a".repeat(64);
const facts = (overrides = {}) => ({
  connection: connection(),
  evidence: [createResearchEvidence(evidenceNote(), evidencePage)],
  selectedAnswer: null,
  previous: null,
  basisDigest: hash,
  currentBasisDigest: hash,
  answerCount: 0,
  ...overrides,
});

test("capability contracts reject credentials, invented authority and out-of-bound input", () => {
  for (const field of [
    "token",
    "secret",
    "headers",
    "ownerId",
    "credentialRef",
  ])
    assert.throws(() =>
      parseConnectionMetadata({ ...connection(), [field]: "not-allowed" }),
    );
  for (const extra of [
    { verified: true },
    { status: "tested" },
    { key: "bad/key" },
    { operation: "🙂".repeat(251) },
    { basis: { ...decision().basis, ownerId: "other" } },
  ])
    assert.throws(() => parseBuilderResearch(decision(extra)));
  const tool = decision();
  assert.equal(
    serializeBuilderResearch(
      Object.fromEntries(Object.entries(tool).reverse()),
    ),
    serializeBuilderResearch(tool),
  );
  const value = createCapabilityDecision(tool, facts());
  assert.throws(() =>
    parseBuilderResearchResult(tool, {
      kind: tool.kind,
      status: "completed",
      result: { ...value, verification: "tested" },
    }),
  );
});

test("the same rules cover unrelated requested operations, without requiring accounts for Restyle features", () => {
  for (const [operation, status] of [
    ["Read calendar free times", "available"],
    ["Send an equipment request to a work tracker", "needs_adapter"],
    ["Request a restaurant table by telephone", "manual"],
    ["Find an unfamiliar river gauge's current reading", "unverified"],
  ]) {
    const tool = decision({ operation, status, selection: "proposed" });
    const evidence = createResearchEvidence(
      evidenceNote({ operation }),
      evidencePage,
    );
    assert.equal(
      createCapabilityDecision(tool, facts({ evidence: [evidence] })).decision
        .operation,
      operation,
    );
  }
  for (const type of ["component_logic", "container_state"]) {
    const tool = decision({
      operation: "Collect volunteer preferences",
      outcome: "Save preferences in this project's own records",
      basis: {
        type,
        evidenceIds: [],
        connectionReadId: null,
        connectionId: null,
        adapterOperation: null,
        permissions: [],
      },
    });
    assert.equal(
      createCapabilityDecision(tool, facts({ connection: null, evidence: [] }))
        .decision.status,
      "available",
    );
  }
  const tool = decision({ status: "manual", answerQuestionId: "date" });
  assert.throws(
    () => createCapabilityDecision(tool, facts()),
    /creator's choice/,
  );
  const selectedAnswer = {
    ...question(),
    alternative: alternative({
      originalOutcome: tool.operation,
      preparedOutcome: tool.outcome,
    }),
    answer: {
      operationId: "choice",
      value: "Use this alternative",
      answeredAt: 1,
    },
  };
  assert.throws(
    () =>
      createCapabilityDecision(
        tool,
        facts({
          selectedAnswer: { ...selectedAnswer, alternative: undefined },
        }),
      ),
    /creator's choice/,
  );
  assert.equal(
    createCapabilityDecision(tool, facts({ selectedAnswer })).decision.outcome,
    tool.outcome,
  );
});

test("documented public features do not grant private access or hide uncertain evidence", () => {
  for (const change of [
    null,
    connection({ status: "revoked" }),
    connection({ permissions: [] }),
    connection({ operations: [] }),
  ])
    assert.throws(
      () => createCapabilityDecision(decision(), facts({ connection: change })),
      /connected account/,
    );
  const uncertain = createResearchEvidence(
    evidenceNote({
      support: "unclear",
      uncertainty: ["Only a marketing page is available"],
    }),
    evidencePage,
  );
  assert.throws(
    () =>
      createCapabilityDecision(decision(), facts({ evidence: [uncertain] })),
    /Unclear/,
  );
  assert.throws(
    () =>
      createCapabilityDecision(
        decision(),
        facts({ basisDigest: "b".repeat(64) }),
      ),
    /Documentation has changed/,
  );
});

test("a question can schedule only independent read research and both schema and parser expose it", () => {
  const definitions = builderResearchDefinitions([
    "web_read",
    "connections_read",
    "capability_record",
  ]);
  const value = {
    kind: "ask_research",
    prompt: "Which account should supply availability?",
    choices: ["Work", "Personal"],
    calls: [{ kind: "connections_read", after: null }],
  };
  assert.deepEqual(
    parseBuilderDecision(value, {
      hasAgreement: false,
      available: definitions.map((tool) => tool.kind),
    }),
    value,
  );
  assert.throws(
    () =>
      parseBuilderDecision(
        { ...value, calls: [decision()] },
        { hasAgreement: false, available: ["capability_record"] },
      ),
    /unanswered outcome/,
  );
  const schema = builderDecisionSchema(false, definitions).anyOf.find(
    (option) => option.properties.kind.const === "ask_research",
  );
  assert.equal(
    schema.properties.calls.items.anyOf.some(
      (option) => option.properties.kind.const === "capability_record",
    ),
    false,
  );
});
