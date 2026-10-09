import {
  newServiceTestReport,
  appendServiceCaseResult,
  inspectServiceReply,
} from "../../../packages/pvo-assistant/services/index.js";
import { prepareServiceArtifact } from "../../../server/assistant/validation/artifact.js";

async function runCases(sandbox, pkg, agreement, cases) {
  const results = [];
  for (const scenario of cases) {
    let state = structuredClone(scenario.initialState),
      failure = null,
      completedSteps = 0;
    for (const [index, step] of scenario.steps.entries()) {
      const invocation = {
        operation: step.operation,
        input: step.input,
        state,
        now: step.now,
      };
      try {
        const actual = await sandbox.execute(
          pkg.files,
          pkg.entrypoint,
          invocation,
        );
        const problem = inspectServiceReply(
          agreement,
          invocation,
          step.expected,
          actual,
        );
        if (problem) {
          failure = { step: index, ...problem };
          break;
        }
        state = actual.state;
        completedSteps++;
      } catch {
        failure = {
          step: index,
          code: "execution_failed",
          detail:
            "Generated operation did not return a valid result in the isolated check.",
        };
        break;
      }
    }
    results.push({
      id: scenario.id,
      status: failure ? "failed" : "passed",
      completedSteps,
      failure,
    });
    if (failure) break;
  }
  return results;
}

/** Expectations and pass authority remain outside all generated processes. */
export async function comparisonReview(state, snapshot, scenario, sandbox) {
  const review =
    state.decision.kind === "review" ? state.decision : state.decision.review;
  try {
    const artifact = await prepareServiceArtifact(state, snapshot);
    if (review.libraries.length)
      throw new Error(
        "This comparison uses only Node built-ins; select libraries: [].",
      );
    const generated = await sandbox.command(
      snapshot.files,
      "test",
      review.tests,
    );
    if (generated.exitCode !== 0)
      return {
        feedback: {
          review,
          report: null,
          error:
            `Selected generated tests failed: ${generated.stdout}\n${generated.stderr}`.slice(
              0,
              1024,
            ),
        },
        generated,
        holdouts: null,
      };
    let report = newServiceTestReport(artifact.agreement, artifact.identity);
    const publicCases = await runCases(
      sandbox,
      artifact.package,
      artifact.agreement,
      artifact.agreement.cases,
    );
    for (const result of publicCases)
      report = appendServiceCaseResult(
        report,
        artifact.agreement,
        artifact.identity,
        result,
      );
    if (report.status !== "passed")
      return {
        feedback: { review, report, error: null },
        generated,
        holdouts: null,
      };
    const holdouts = await runCases(
      sandbox,
      artifact.package,
      artifact.agreement,
      scenario.holdouts,
    );
    const failed = holdouts.find((result) => result.status !== "passed");
    return {
      generated,
      holdouts,
      feedback: failed
        ? {
            review,
            report: null,
            error:
              `Independent additional case ${failed.id} failed: ${failed.failure.detail}`.slice(
                0,
                1024,
              ),
          }
        : { review, report, error: null },
    };
  } catch (error) {
    return {
      feedback: { review, report: null, error: error.message.slice(0, 1024) },
      generated: null,
      holdouts: null,
    };
  }
}
