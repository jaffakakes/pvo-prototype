import { requireTask } from "../tasks/validation.js";
import {
  parseCapabilityResearch,
  parseCapabilityResult,
} from "./capabilities.js";

/** Pure planning rules. Facts are resolved by the task/account adapters, never supplied as model authority. */
export function createCapabilityDecision(value, facts) {
  const tool = parseCapabilityResearch(value),
    basis = tool.basis;
  const { connection, evidence, selectedAnswer, previous } = facts;
  if (basis.type === "external") {
    requireTask(
      tool.status === "unverified" ||
        (basis.evidenceIds.length > 0 && evidence.length > 0),
      "Research actual integration documentation before deciding support.",
    );
    requireTask(
      evidence.every((note) => note.assessment.operation === tool.operation),
      "Research must address this exact requested operation.",
    );
    if (["available", "needs_account", "needs_adapter"].includes(tool.status))
      requireTask(
        evidence.some((note) => note.assessment.support === "documented") &&
          evidence.every((note) => note.assessment.support !== "unclear"),
        "Unclear support must remain unverified.",
      );
    if (tool.status === "available") {
      const adapter = connection?.operations.find(
        (operation) => operation.id === basis.adapterOperation,
      );
      requireTask(
        connection?.status === "connected" &&
          adapter &&
          [...adapter.permissions, ...basis.permissions].every((permission) =>
            connection.permissions.includes(permission),
          ),
        "The connected account and installed adapter must permit this operation.",
      );
    }
  }
  if (tool.status === "manual" && tool.selection === "selected")
    requireTask(
      selectedAnswer?.answer,
      "Save the creator's choice before selecting a manual alternative.",
    );
  requireTask(
    facts.basisDigest === facts.currentBasisDigest,
    "Documentation has changed; inspect the new evidence before deciding.",
  );
  if (
    previous?.decision.selection === "selected" &&
    previous.decision.outcome !== tool.outcome
  )
    requireTask(
      previous.basisDigest !== facts.basisDigest,
      "Reuse the chosen outcome until the creator answers again or evidence changes.",
    );
  return parseCapabilityResult(tool, {
    decision: tool,
    basisDigest: facts.basisDigest,
    connectionRevision: connection?.revision ?? null,
    answerCount: facts.answerCount,
    verification: "planning_only",
  });
}
