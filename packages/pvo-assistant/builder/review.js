import { object, text, requireTask } from "../tasks/validation.js";
import { parseServiceTestReport } from "../services/index.js";
import { parseBuilderDecision } from "./decisions.js";

export function builderReviewRequest(state) {
  if (state.decision?.kind === "review") return state.decision;
  if (state.decision?.kind === "tools" && state.batchEnd === "completed")
    return state.decision.review;
  return null;
}

export function parseBuilderReviewFeedback(value, agreement) {
  object(value, ["review", "report", "error"], "Independent review feedback");
  requireTask(agreement !== null, "Review needs a saved agreement.");
  const review = parseBuilderDecision(value.review, {
    hasAgreement: true,
    available: [],
  });
  requireTask(
    review.kind === "review",
    "Review feedback needs its source request.",
  );
  if (value.report !== null) {
    requireTask(
      value.error === null,
      "A test report cannot also be an artifact error.",
    );
    const report = parseServiceTestReport(
      value.report,
      agreement.body,
      value.report.identity,
    );
    requireTask(
      report.status !== "running" &&
        report.identity.agreementDigest === agreement.digest &&
        report.identity.sourceDigest === review.digest,
      "Review report must finish testing the saved bytes.",
    );
  } else text(value.error, 1024, "Artifact review error");
  return structuredClone(value);
}
