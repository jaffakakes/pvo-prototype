import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import { parseBuilderResearchResult } from "../../../packages/pvo-assistant/builder/index.js";
import { researchDefinitions } from "./probes.mjs";

/** Preserve the first decision, then use the app's saved-validator feedback without developer hints. */
export async function runPlanning(scenario, row, models, save) {
  const task = {
    input: {
      request: scenario.request,
      examples: [],
      context: { components: [] },
    },
    questions: scenario.questions,
  };
  const feedback = structuredClone(scenario.feedback);
  let evidence = scenario.evidence ?? null;
  row.planningTurns = [];
  row.validationRepairs = 0;
  row.firstDecisionValid = false;
  for (let turn = 1; turn <= 6; turn++) {
    let decision;
    try {
      decision = await planSavedBuild(
        task,
        { agreement: null, feedback, workspace: null },
        researchDefinitions,
        {},
        AbortSignal.timeout(180000),
        evidence,
        models,
      );
      if (turn === 1) {
        row.firstDecisionValid = true;
        row.firstOutput = decision;
      }
    } catch (error) {
      if (!error.feedback) throw error;
      row.validationRepairs++;
      row.planningTurns.push({ turn, repair: error.feedback });
      evidence = {
        ...evidence,
        repair: { sequence: row.validationRepairs, ...error.feedback },
      };
      await save();
      continue;
    }
    row.planningTurns.push({ turn, decision });
    row.output = decision;
    if (
      scenario.id !== "P07" ||
      ["ask", "connect_account", "ask_research"].includes(decision.kind)
    ) {
      row.status = "needs_semantic_grade";
      await save();
      return;
    }
    // The frozen missing-account probe has no installed setup flow. Its continuation
    // deliberately supplies no public-network access or credentials. It must reach
    // concrete, honest setup/help instead of treating repeated reads as completion.
    if (decision.kind !== "research") break;
    const completed = [];
    for (const [index, call] of decision.calls.entries()) {
      if (!["connections_read", "web_read", "web_search"].includes(call.kind))
        break;
      const result = parseBuilderResearchResult(
        call,
        call.kind === "connections_read"
          ? {
              kind: call.kind,
              status: "completed",
              result: { connections: [], next: null, version: 0 },
            }
          : { kind: call.kind, status: "unavailable", result: null },
      );
      completed.push({
        operationId: `planning-${turn}-${index + 1}`,
        kind: call.kind,
        result,
      });
    }
    row.planningTurns.at(-1).controlledFeedback = completed;
    feedback.push(...completed);
    evidence = null;
    await save();
    if (completed.length !== decision.calls.length) break;
  }
  row.status = "planning_observation_exhausted";
  await save();
}
