import assert from "node:assert/strict";
import test from "node:test";
import { runPlanning } from "../../scripts/checks/restyle-capability/planning.mjs";
import { planningProbes } from "../../scripts/checks/restyle-capability/probes.mjs";
const probe = (id) => planningProbes().find((item) => item.id === id);
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

test("planning evaluation distinguishes first-decision failure from autonomous validated repair", async () => {
  const row = {},
    seen = [];
  await runPlanning(
    probe("P02"),
    row,
    {
      async generate(request) {
        assert.equal(request.purpose, "saved_authoring");
        seen.push(context(request.messages));
        return {
          content: JSON.stringify({
            kind: "ask",
            prompt: "What are viewers booking?",
            choices: [],
            ...(seen.length === 1 ? { calls: [] } : {}),
          }),
        };
      },
    },
    async () => {},
  );
  assert.equal(row.status, "needs_semantic_grade");
  assert.equal(row.firstDecisionValid, false);
  assert.equal(row.validationRepairs, 1);
  assert.equal(row.planningTurns.length, 2);
  assert.ok(seen[1].evidence.repair.proposal.text.includes('"calls":[]'));
  assert.match(seen[1].evidence.repair.message, /Unsupported field count: 1/);
  assert.equal(row.output.prompt, "What are viewers booking?");
});

test("missing-account continuation returns honest controlled absence and needs a concrete decision", async () => {
  const row = {},
    seen = [];
  const first = {
    kind: "research",
    calls: [
      { kind: "connections_read", after: null },
      {
        kind: "web_read",
        url: "https://docs.agentmail.to/api-reference/inboxes/messages/send",
      },
    ],
  };
  await runPlanning(
    probe("P07"),
    row,
    {
      async generate(request) {
        seen.push(context(request.messages));
        return {
          content: JSON.stringify(
            seen.length === 1
              ? first
              : {
                  kind: "ask",
                  prompt:
                    "Enable your agent email in the private account setup, then return here. No message has been sent.",
                  choices: [],
                },
          ),
        };
      },
    },
    async () => {},
  );
  assert.equal(row.firstDecisionValid, true);
  assert.deepEqual(row.firstOutput, first);
  assert.equal(row.planningTurns.length, 2);
  assert.deepEqual(
    seen[1].build.feedback.slice(-2).map((row) => row.result),
    [
      {
        kind: "connections_read",
        status: "completed",
        result: { connections: [], next: null, version: 0 },
      },
      { kind: "web_read", status: "unavailable", result: null },
    ],
  );
  assert.equal(row.status, "needs_semantic_grade");
  const stuck = {};
  await runPlanning(
    probe("P07"),
    stuck,
    { generate: async () => ({ content: JSON.stringify(first) }) },
    async () => {},
  );
  assert.equal(stuck.status, "planning_observation_exhausted");
  assert.equal(stuck.planningTurns.length, 6);
});
