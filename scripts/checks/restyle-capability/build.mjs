import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import {
  newBuilderState,
  acceptBuilderDecision,
  beginBuilderBatch,
  nextBuilderTool,
  recordBuilderTool,
  builderContext,
  builderStage,
  recordBuilderReview,
} from "../../../packages/pvo-assistant/builder/index.js";
import { serializeServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";
import { comparisonWorkspace, digest } from "../model-comparison/workspace.mjs";
import { comparisonReview } from "../model-comparison/review.mjs";
export async function runBuild(scenario, row, sandbox, model, save) {
  const started = performance.now();
  row.decisions = [];
  row.reviews = [];
  row.validationRepairs = 0;
  row.toolFailures = 0;
  if (scenario.agreement.connections?.length)
    scenario = {
      ...scenario,
      resolveAccount: (request, step) => {
        if (
          request.connection !== "issue" ||
          request.input.number !== step.input.number
        )
          throw new Error("Wrong controlled account request.");
        return { title: step.expected.result };
      },
    };
  const workspace = comparisonWorkspace(sandbox);
  let state = acceptBuilderDecision(
    newBuilderState(),
    { kind: "agreement", agreement: scenario.agreement },
    digest(serializeServiceAgreement(scenario.agreement)),
  );
  let evidence = null;
  const task = {
    input: {
      request: scenario.request,
      examples: [],
      context: { components: [] },
    },
    questions: [],
  };
  try {
    if (scenario.seed) {
      const tool = {
        kind: "workspace_write",
        expectedRevision: 0,
        files: scenario.seed,
      };
      await workspace.execute(tool, "seed-source");
      const source = workspace.snapshot();
      state = acceptBuilderDecision(state, {
        kind: "review",
        libraries: [],
        revision: source.revision,
        digest: source.digest,
        entrypoint: "src/service.mjs",
        tests: ["tests/service.test.mjs"],
      });
    }
    for (;;) {
      if (performance.now() - started >= 600000) {
        row.status = "observation_window_exhausted";
        break;
      }
      row.savedState = state;
      row.source = workspace.snapshot();
      await save();
      if (builderStage(state) === "review") {
        const checked = await comparisonReview(
          state,
          workspace.snapshot(),
          scenario,
          sandbox,
        );
        row.reviews.push(checked);
        state = recordBuilderReview(state, checked.feedback);
        if (checked.feedback.report?.status === "passed") {
          row.status = "passed";
          break;
        }
        console.log(
          `${scenario.id} / ${row.repetition}: independent check failed; returning evidence to the model.`,
        );
        continue;
      }
      const context = {
        ...builderContext(state),
        workspace: workspace.snapshot(),
      };
      let decision;
      try {
        decision = await planSavedBuild(
          task,
          context,
          workspace.definitions,
          {},
          AbortSignal.timeout(
            Math.max(
              1,
              Math.min(
                180000,
                Math.floor(600000 - (performance.now() - started)),
              ),
            ),
          ),
          evidence,
          model,
        );
      } catch (error) {
        if (!error.feedback) throw error;
        row.validationRepairs++;
        evidence = {
          repair: {
            sequence: row.validationRepairs,
            check: error.feedback.check,
            message: error.feedback.message,
            proposal: { text: error.feedback.proposal, truncated: false },
          },
        };
        console.log(
          `${scenario.id} / ${row.repetition}: decision rejected; returning the validator feedback.`,
        );
        await save();
        continue;
      }
      row.decisions.push(decision);
      evidence = null;
      console.log(
        `${scenario.id} / ${row.repetition}: ${decision.kind}, inference calls ${row.attempts.length}`,
      );
      if (decision.kind === "history") {
        const collection = {
          input: task.input,
          agreement: state.agreement,
          workspace: workspace.snapshot(),
          operations: state.feedback,
          reviews: row.reviews,
        }[decision.collection];
        const text = JSON.stringify(collection ?? []),
          points = [...text];
        evidence = {
          selection: {
            collection: decision.collection,
            sequence: decision.after === 0 ? 1 : null,
            offset: decision.offset,
            text: points
              .slice(decision.offset, decision.offset + 4096)
              .join(""),
            nextOffset:
              points.length > decision.offset + 4096
                ? decision.offset + 4096
                : null,
          },
          notes: decision.notes,
        };
        continue;
      }
      if (!["tools", "review"].includes(decision.kind)) {
        row.status = "needs_creator_input";
        row.question = decision;
        break;
      }
      state = acceptBuilderDecision(state, decision);
      if (decision.kind === "tools") {
        state = beginBuilderBatch(state, state.round);
        for (;;) {
          const next = nextBuilderTool(state);
          if (!next) break;
          let result,
            halt = false;
          try {
            result = await workspace.execute(next.tool, next.operationId);
            halt =
              result.status === "interrupted" ||
              (result.kind === "command" && result.result.exitCode !== 0);
          } catch (error) {
            result = { error: error.message.slice(0, 1024) };
            halt = true;
          }
          if (halt) row.toolFailures++;
          state = recordBuilderTool(state, next, result, halt);
          row.savedState = state;
          row.source = workspace.snapshot();
          await save();
        }
        workspace.endBatch();
      }
    }
  } catch (error) {
    row.status = "execution_error";
    row.failure = error.message;
  } finally {
    row.savedState = state;
    row.source = workspace.snapshot();
    row.elapsedMs = performance.now() - started;
    row.completedAt = new Date().toISOString();
    await save();
    console.log(
      `Finished ${scenario.id} / ${row.repetition}: ${row.status}, ${(row.elapsedMs / 1000).toFixed(1)}s`,
    );
  }
}
