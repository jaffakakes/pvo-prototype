import assert from "node:assert/strict";
import test from "node:test";
import { measuredModels } from "../../scripts/checks/restyle-capability/provider.mjs";
import { planningProbes } from "../../scripts/checks/restyle-capability/probes.mjs";
import { runPlanning } from "../../scripts/checks/restyle-capability/planning.mjs";

test(
  "evaluation retains a failed first inference and retries identical input with the application policy",
  { timeout: 20000 },
  async () => {
    const row = { attempts: [] };
    const requests = [];
    const models = await measuredModels(
      async (attempt) => {
        row.attempts[attempt.sequence - 1] = attempt;
      },
      {
        apiKey: "private-test-key",
        fetchImpl: async (_url, options) => {
          requests.push(options.body);
          if (requests.length === 1) return new Response(null, { status: 503 });
          return Response.json({
            model: "kimi-k3",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    kind: "ask",
                    prompt: "What are friends booking?",
                    choices: ["Seats", "Time slots"],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });
        },
      },
    );
    await runPlanning(
      planningProbes().find((scenario) => scenario.id === "P02"),
      row,
      models,
      async () => {},
    );
    assert.equal(row.status, "needs_semantic_grade");
    assert.equal(row.firstDecisionValid, false);
    assert.equal(row.validationRepairs, 0);
    assert.equal(row.attempts.length, 2);
    assert.equal(row.attempts[0].outcome, "provider_rejected");
    assert.equal(row.attempts[0].usage, null);
    assert.equal(row.attempts[1].outcome, "returned");
    assert.equal(row.inferenceRetries[0].retryMs, 10000);
    assert.equal(row.inferenceRetries[0].afterAttempt, 1);
    assert.equal(requests[0], requests[1]);
    assert.equal(row.output.kind, "ask");
    assert.ok(!JSON.stringify(row).includes("private-test-key"));
  },
);
