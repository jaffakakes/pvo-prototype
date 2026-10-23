import {
  parseTaskReference,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";

export type BuildDiagnostic = {
  stepId: string;
  review: null | {
    revision: number;
    digest: string;
    status: "running" | "passed" | "failed" | "interrupted" | "artifact_error";
    caseId: string | null;
    step: number | null;
    detail: string;
  };
  repair: null | {
    check: string;
    message: string;
    repetitions: number;
    proposal: { text: string; truncated: boolean };
  };
};

/** Private generated text is display data; it never authorizes a command. */
export function parseBuildDiagnostic(
  value: unknown,
  expected: TaskReference,
): BuildDiagnostic {
  const invalid = () => new Error("The saved build details are invalid.");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const body = value as Record<string, unknown>;
  const ref = parseTaskReference(body.reference);
  if (
    ref.ownerId !== expected.ownerId ||
    ref.projectId !== expected.projectId ||
    ref.taskId !== expected.taskId
  )
    throw invalid();
  if (typeof body.stepId !== "string" || body.stepId.length > 128)
    throw invalid();
  const review = parseReview(body.review);
  if (body.repair === null)
    return { stepId: body.stepId, repair: null, review };
  if (
    !body.repair ||
    typeof body.repair !== "object" ||
    Array.isArray(body.repair)
  )
    throw invalid();
  const repair = body.repair as Record<string, unknown>;
  if (
    typeof repair.check !== "string" ||
    repair.check.length > 128 ||
    typeof repair.message !== "string" ||
    new TextEncoder().encode(repair.message).length > 2048 ||
    typeof repair.repetitions !== "number" ||
    !Number.isSafeInteger(repair.repetitions) ||
    repair.repetitions < 1
  )
    throw invalid();
  if (
    !repair.proposal ||
    typeof repair.proposal !== "object" ||
    Array.isArray(repair.proposal)
  )
    throw invalid();
  const proposal = repair.proposal as Record<string, unknown>;
  if (
    typeof proposal.text !== "string" ||
    new TextEncoder().encode(proposal.text).length > 128 * 1024 ||
    typeof proposal.truncated !== "boolean"
  )
    throw invalid();
  return {
    stepId: body.stepId,
    review,
    repair: {
      check: repair.check,
      message: repair.message,
      repetitions: repair.repetitions,
      proposal: { text: proposal.text, truncated: proposal.truncated },
    },
  };
}

function parseReview(value: unknown): BuildDiagnostic["review"] {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The saved independent check is invalid.");
  const review = value as Record<string, unknown>;
  const { revision, digest, status, caseId, step, detail } = review;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    (status !== "running" &&
      status !== "passed" &&
      status !== "failed" &&
      status !== "interrupted" &&
      status !== "artifact_error") ||
    (caseId !== null &&
      (typeof caseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(caseId))) ||
    (step !== null &&
      (typeof step !== "number" || !Number.isSafeInteger(step) || step < 0)) ||
    (caseId === null) !== (step === null) ||
    typeof detail !== "string" ||
    new TextEncoder().encode(detail).length > 2048
  )
    throw new Error("The saved independent check is invalid.");
  return { revision, digest, status, caseId, step, detail };
}
