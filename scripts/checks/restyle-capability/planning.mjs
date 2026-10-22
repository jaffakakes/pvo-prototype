import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import { researchDefinitions } from "./probes.mjs";
import { missingAccountResearch } from "./planning-research.mjs";

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
  const research =
    scenario.id === "P07" ? await missingAccountResearch(task, feedback) : null;
  try {
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
      // Empty accounts and unavailable public research remain controlled facts.
      // Actual capability validation must return its result before the next decision.
      if (decision.kind !== "research") break;
      const completed = [];
      for (const [index, call] of decision.calls.entries()) {
        const operationId = `planning-${turn}-${index + 1}`;
        const result = await research.execute(call, operationId);
        completed.push({
          operationId,
          kind: call.kind,
          result,
        });
        // The real builder halts dependent calls after unavailable/rejected research.
        if (result.status !== "completed") break;
      }
      row.planningTurns.at(-1).controlledFeedback = completed;
      feedback.push(...completed);
      const capabilities = await research.capabilities();
      evidence = capabilities.decisions.length ? { capabilities } : null;
      await save();
    }
    row.status = "planning_observation_exhausted";
    await save();
  } finally {
    research?.close();
  }
}
