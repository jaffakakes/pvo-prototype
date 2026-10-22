import { isDeepStrictEqual } from "node:util";
import { executeConnectedOperation } from "../../../server/cloud-services/connectedExecution.js";
import {
  newServiceTestReport,
  appendServiceCaseResult,
  inspectServiceReply,
} from "../../../packages/pvo-assistant/services/index.js";
import { prepareServiceArtifact } from "../../../server/assistant/validation/artifact.js";

export async function runCases(
  sandbox,
  pkg,
  agreement,
  cases,
  resolveAccount = null,
) {
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
        const requests = [];
        const actual = agreement.connections?.length
          ? await executeConnectedOperation({
              agreement,
              invocation,
              signal: AbortSignal.timeout(30000),
              execute: (input) =>
                sandbox.execute(pkg.files, pkg.entrypoint, input),
              invoke: resolveAccount
                ? async (request) => {
                    requests.push(request);
                    return resolveAccount(request, step);
                  }
                : null,
            })
          : await sandbox.execute(pkg.files, pkg.entrypoint, invocation);
        if (
          resolveAccount &&
          !isDeepStrictEqual(requests, step.requests ?? [])
        ) {
          failure = {
            step: index,
            code: "mismatch",
            detail:
              "Actual account requests differ from the independent ordered expectations.",
          };
          break;
        }
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
      scenario.resolveAccount,
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
      scenario.resolveAccount,
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
