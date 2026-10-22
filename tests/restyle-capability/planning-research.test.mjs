import assert from "node:assert/strict";
import test from "node:test";
import { runPlanning } from "../../scripts/checks/restyle-capability/planning.mjs";
import { missingAccountResearch } from "../../scripts/checks/restyle-capability/planning-research.mjs";
import { planningProbes } from "../../scripts/checks/restyle-capability/probes.mjs";

const scenario = () => planningProbes().find((item) => item.id === "P07");
const capability = (changes = {}) => ({
  kind: "capability_record",
  key: "send_thanks",
  operation: "Send a fixed thank-you email to friend@example.com",
  outcome: "The viewer receives an accepted-send receipt.",
  selection: "selected",
  status: "needs_account",
  reason: "No account is connected, and public documentation is unavailable.",
  basis: {
    type: "external",
    evidenceIds: [],
    connectionReadId: "build-1-2",
    connectionId: null,
    adapterOperation: null,
    permissions: [],
  },
  answerQuestionId: null,
  ...changes,
});
const context = (messages) =>
  messages
    .flatMap((message) => {
      try {
        return [JSON.parse(message.content)];
      } catch {
        return [];
      }
    })
    .find((value) => value.input);

const manualDecision = (capabilityId) => ({
  kind: "manual_alternative",
  proposal: {
    capabilityId,
    originalOutcome: capability().operation,
    preparedOutcome: "Save thank-you requests for the creator to send later.",
    limitation: "No email account or private setup is available.",
    notice: "Request saved; the creator still needs to send the email.",
    fields: [],
    steps: [
      {
        id: "send",
        instruction: "Read the saved request and send the email manually.",
      },
    ],
  },
});

test("a researched manual alternative is terminal help, with a separate semantic grade", async () => {
  const row = {};
  let calls = 0;
  const alternative = manualDecision("planning-1-1");
  await runPlanning(
    scenario(),
    row,
    {
      async generate() {
        calls++;
        return {
          content: JSON.stringify(
            calls === 1
              ? {
                  kind: "research",
                  calls: [
                    capability({ status: "unverified", selection: "proposed" }),
                  ],
                }
              : alternative,
          ),
        };
      },
    },
    async () => {},
  );
  assert.equal(calls, 2);
  assert.equal(row.status, "needs_semantic_grade");
  assert.equal(row.firstDecisionValid, true);
  assert.deepEqual(row.output, alternative);
  assert.equal(
    row.planningTurns[0].controlledFeedback[0].result.result.verification,
    "planning_only",
  );
});

test("an alternative without a current owned capability is repaired instead of accepted", async () => {
  const row = {},
    seen = [];
  await runPlanning(
    scenario(),
    row,
    {
      async generate(request) {
        seen.push(context(request.messages));
        return {
          content: JSON.stringify(
            seen.length === 1
              ? manualDecision("invented")
              : {
                  kind: "ask",
                  prompt: "Email setup is unavailable. Would you like to wait?",
                  choices: [],
                },
          ),
        };
      },
    },
    async () => {},
  );
  assert.equal(row.status, "needs_semantic_grade");
  assert.equal(row.firstDecisionValid, false);
  assert.equal(row.validationRepairs, 1);
  assert.equal(row.output.kind, "ask");
  assert.match(seen[1].evidence.repair.message, /current capability/);
});

test("missing-account evaluation returns real rejection, then planning-only evidence, before a concrete question", async () => {
  const row = {},
    seen = [];
  await runPlanning(
    scenario(),
    row,
    {
      async generate(request) {
        seen.push(context(request.messages));
        const decision =
          seen.length === 3
            ? {
                kind: "ask",
                prompt:
                  "No email account is connected and research is unavailable. Can you use the private account setup and then return here? No email has been sent.",
                choices: [],
              }
            : {
                kind: "research",
                calls: [
                  capability(seen.length === 2 ? { status: "unverified" } : {}),
                  {
                    kind: "web_read",
                    url: "https://docs.agentmail.to/api-reference/inboxes/messages/send",
                  },
                ],
              };
        return { content: JSON.stringify(decision) };
      },
    },
    async () => {},
  );
  assert.equal(row.firstDecisionValid, true);
  assert.equal(row.validationRepairs, 0);
  assert.equal(row.status, "needs_semantic_grade");
  assert.equal(row.planningTurns.length, 3);
  const rejected = row.planningTurns[0].controlledFeedback;
  assert.equal(
    rejected.length,
    1,
    "Rejected research must stop dependent calls",
  );
  assert.equal(rejected[0].result.status, "rejected");
  assert.equal(
    rejected[0].result.result.message,
    "Research actual integration documentation before deciding support.",
  );
  assert.deepEqual(seen[1].build.feedback.at(-1), rejected[0]);
  const saved = seen[2].evidence.capabilities.decisions[0];
  assert.equal(saved.verification, "planning_only");
  assert.equal(saved.decision.status, "unverified");
  assert.equal(saved.current, true);
  assert.equal(
    row.output.kind,
    "ask",
    "Saving a capability note is not workflow completion",
  );
});

test("controlled planning uses owned receipts and cannot manufacture accounts, documentation or chosen alternatives", async () => {
  const probe = scenario();
  const research = await missingAccountResearch(
    { input: { request: probe.request }, questions: [] },
    probe.feedback,
  );
  try {
    const base = capability();
    for (const [change, message] of [
      [
        { basis: { ...base.basis, connectionReadId: "invented" } },
        /completed connections_read/,
      ],
      [
        { basis: { ...base.basis, evidenceIds: ["build-1-2"] } },
        /completed web_evidence/,
      ],
      [
        {
          status: "available",
          basis: { ...base.basis, connectionId: "invented" },
        },
        /current connection and permissions/,
      ],
      [{ answerQuestionId: "invented" }, /answered question/],
    ]) {
      const result = await research.execute(
        capability(change),
        "rejected-" + message.source.replace(/\W/g, "_"),
      );
      assert.equal(result.status, "rejected");
      assert.match(result.result.message, message);
    }
    const page = await research.execute(
      {
        kind: "web_read",
        url: "https://docs.agentmail.to/api-reference/inboxes/messages/send",
      },
      "unavailable-page",
    );
    assert.equal(page.status, "unavailable");
    const note = await research.execute(
      {
        kind: "web_evidence",
        sourceOperationId: "unavailable-page",
        operation: base.operation,
        support: "documented",
        excerpts: ["invented"],
        accessRequirements: [],
        uncertainty: [],
        stillNeedsTesting: ["Actual access"],
      },
      "invented-note",
    );
    assert.equal(note.status, "rejected");
    assert.match(note.result.message, /completed web_read/);
    const saved = await research.execute(
      capability({ status: "unverified" }),
      "unverified",
    );
    assert.equal(saved.status, "completed");
    assert.equal(saved.result.verification, "planning_only");
    const replacement = await research.execute(
      capability({
        status: "unverified",
        outcome: "A different outcome without the creator's answer",
      }),
      "replacement",
    );
    assert.equal(replacement.status, "rejected");
    assert.match(replacement.result.message, /Reuse the chosen outcome/);
  } finally {
    research.close();
  }
});
