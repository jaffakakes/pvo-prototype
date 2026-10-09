import {
  parseTaskReference,
  type TaskReference,
} from "../../../../packages/pvo-assistant/tasks/index.js";

export type BuildDiagnostic = {
  stepId: string;
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
  if (body.repair === null) return { stepId: body.stepId, repair: null };
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
    repair: {
      check: repair.check,
      message: repair.message,
      repetitions: repair.repetitions,
      proposal: { text: proposal.text, truncated: proposal.truncated },
    },
  };
}
