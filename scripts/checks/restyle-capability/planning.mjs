import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import { AuthoringRepairError } from "../../../server/assistant/tasks/repairFeedback.js";
import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
import { researchDefinitions } from "./probes.mjs";
import { missingAccountResearch } from "./planning-research.mjs";
import { recordInferenceRetry } from "./inference-recovery.mjs";

/** Preserve the first decision, then use the app's saved-validator feedback without developer hints. */
export async function runPlanning(scenario, row, models, save) {
  const task = {
    input: {
      request: scenario.request,
      examples: [],
      context: scenario.context ?? { components: [] },
    },
    questions: structuredClone(scenario.questions),
  };
  const feedback = structuredClone(scenario.feedback);
  let evidence = scenario.evidence ?? null;
  row.planningTurns = [];
  row.validationRepairs = 0;
  row.firstDecisionValid = false;
  let inferenceFailures = 0;
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
          AbortSignal.timeout(TASK_LIMITS.authoringAttemptMs),
          evidence,
          models,
        );
        if (research && decision.kind === "manual_alternative") {
          try {
            await research.validateManualAlternative(decision);
          } catch (error) {
            throw new AuthoringRepairError(
              "builder_response",
              error.message,
              decision,
            );
          }
        }
        inferenceFailures = 0;
        if (turn === 1) {
          row.firstDecisionValid = true;
          row.firstOutput = decision;
        }
      } catch (error) {
        if (!error.feedback) {
          if (await recordInferenceRetry(error, row, ++inferenceFailures, save))
            continue;
          throw error;
        }
        inferenceFailures = 0;
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
      if (decision.kind === "ask" && scenario.scriptedAnswers?.length) {
        const index = row.scriptedAnswers?.length ?? 0;
        const value = scenario.scriptedAnswers[index];
        if (value) {
          const question = {
            id: `scripted-${index}`,
            prompt: decision.prompt,
            answer: { value, answeredAt: 1000 + index },
          };
          task.questions.push(question);
          (row.scriptedAnswers ??= []).push(question);
          await save();
          continue;
        }
      }
      if (
        scenario.id !== "P07" ||
        [
          "ask",
          "connect_account",
          "ask_research",
          "manual_alternative",
        ].includes(decision.kind)
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
