import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
import { comparisonScenarios } from "./scenarios.mjs";
import { comparisonSandbox } from "./sandbox.mjs";
import { comparisonWorkspace, digest } from "./workspace.mjs";
import { comparisonProvider } from "./providers.mjs";
import { comparisonReview } from "./review.mjs";

const root = join(homedir(), ".codex/secure/restyle-model-comparison");
await mkdir(root, { recursive: true, mode: 0o700 });
const directory = join(
  root,
  `run-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(directory, { mode: 0o700 });
const report = {
  policy: "restyle-coding-comparison-v1",
  startedAt: new Date().toISOString(),
  scope:
    "Coding after an identical frozen behavior agreement; excludes UI generation, intent/research, cloud startup and hosted deployment.",
  modelTurnLimit: null,
  resources: [],
  builds: [],
};
async function save() {
  const temporary = join(directory, "report.tmp");
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, join(directory, "report.json"));
}
await save();
console.log(`Private comparison journal: ${directory}/report.json`);
const sandbox = await comparisonSandbox(async (resource) => {
  const index = report.resources.findIndex(
    (item) => item.name === resource.name,
  );
  if (index < 0) report.resources.push(structuredClone(resource));
  else report.resources[index] = structuredClone(resource);
  await save();
});
report.runtime = { image: sandbox.image, nodeVersion: sandbox.nodeVersion };
await save();

async function build(scenario, name) {
  const row = {
    scenario: scenario.id,
    candidate: name,
    status: "running",
    startedAt: new Date().toISOString(),
    attempts: [],
    decisions: [],
    reviews: [],
    validationRepairs: 0,
    toolFailures: 0,
    inferenceMs: 0,
    knownEstimatedUsd: 0,
    unknownUsageAttempts: 0,
  };
  report.builds.push(row);
  const started = performance.now();
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
  const model = await comparisonProvider(name, async (attempt) => {
    row.attempts[attempt.sequence - 1] = attempt;
    row.inferenceMs = row.attempts.reduce(
      (sum, item) => sum + (item.elapsedMs ?? 0),
      0,
    );
    row.knownEstimatedUsd = row.attempts.reduce(
      (sum, item) => sum + (item.usage?.estimatedUsd ?? 0),
      0,
    );
    row.unknownUsageAttempts = row.attempts.filter(
      (item) => item.outcome && !item.usage,
    ).length;
    await save();
  });
  row.model = model.candidate;
  console.log(`Starting ${scenario.id} / ${model.candidate.model}`);
  try {
    for (;;) {
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
          `${scenario.id} / ${name}: independent check failed; returning evidence to the model.`,
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
          AbortSignal.timeout(180000),
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
          `${scenario.id} / ${name}: decision rejected; returning the validator feedback.`,
        );
        await save();
        continue;
      }
      row.decisions.push(decision);
      evidence = null;
      console.log(
        `${scenario.id} / ${name}: ${decision.kind}, inference calls ${row.attempts.length}, known estimate $${row.knownEstimatedUsd.toFixed(4)}`,
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
    row.status = "infrastructure_failure";
    row.failure = error.message;
  } finally {
    row.savedState = state;
    row.source = workspace.snapshot();
    row.elapsedMs = performance.now() - started;
    row.completedAt = new Date().toISOString();
    await save();
    console.log(
      `Finished ${scenario.id} / ${name}: ${row.status}, ${(row.elapsedMs / 1000).toFixed(1)}s, known estimate $${row.knownEstimatedUsd.toFixed(4)}`,
    );
  }
}

const selected = process.argv[2];
if (selected && !["kimi", "sol"].includes(selected))
  throw new Error("Optional candidate must be kimi or sol.");
for (const [index, scenario] of comparisonScenarios().entries()) {
  for (const name of selected
    ? [selected]
    : index % 2 === 0
      ? ["kimi", "sol"]
      : ["sol", "kimi"])
    await build(scenario, name);
}
report.completedAt = new Date().toISOString();
report.cleanupVerified = report.resources.every((item) => item.cleaned);
await save();
console.log(
  JSON.stringify(
    {
      directory,
      cleanupVerified: report.cleanupVerified,
      builds: report.builds.map(
        ({
          scenario,
          candidate,
          status,
          elapsedMs,
          inferenceMs,
          knownEstimatedUsd,
          unknownUsageAttempts,
          validationRepairs,
          toolFailures,
          attempts,
        }) => ({
          scenario,
          candidate,
          status,
          seconds: elapsedMs / 1000,
          inferenceSeconds: inferenceMs / 1000,
          knownEstimatedUsd,
          unknownUsageAttempts,
          validationRepairs,
          toolFailures,
          calls: attempts.length,
        }),
      ),
    },
    null,
    2,
  ),
);
