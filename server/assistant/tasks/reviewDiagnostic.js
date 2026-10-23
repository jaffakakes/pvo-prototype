/** Project the saved independent result, never source, credentials or generated test logs. */
export function reviewDiagnostic(feedback) {
  if (!feedback) return null;
  const failed = feedback.report?.cases.find((item) => item.failure);
  return {
    revision: feedback.review.revision,
    digest: feedback.review.digest,
    status: feedback.report?.status ?? "artifact_error",
    caseId: failed?.id ?? null,
    step: failed?.failure.step ?? null,
    detail:
      feedback.error ??
      failed?.failure.detail ??
      (feedback.report?.status === "passed"
        ? "All saved behavior checks passed."
        : "The independent check has not completed."),
  };
}
