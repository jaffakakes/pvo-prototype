import { capabilityContext } from "./capabilityResearch.js";

/** Receipt ownership/freshness comes from existing research, not model-supplied status. */
export async function requireManualChoice(coordinator, task, decision) {
  if (!["manual_alternative", "agreement"].includes(decision.kind)) return;
  const { decisions } = await capabilityContext(coordinator, task);
  if (decision.kind === "manual_alternative") {
    if (task.input.context.container)
      throw new Error("Propose component alternatives in a component task.");
    const receipt = decisions.find(
      (item) => item.operationId === decision.proposal.capabilityId,
    );
    if (!receipt?.current || receipt.decision.status === "available")
      throw new Error(
        "First record a current capability explaining missing or uncertain automation in this task.",
      );
    if (
      task.manualPlans.some(
        (plan) => plan.proposal.capabilityId === decision.proposal.capabilityId,
      )
    )
      throw new Error("Reuse the saved alternative and its manual steps.");
    if (decision.proposal.originalOutcome !== receipt.decision.operation)
      throw new Error(
        "Original outcome must match the researched operation exactly.",
      );
    return;
  }
  for (const plan of task.manualPlans) {
    if (!decision.agreement.description.includes(plan.proposal.preparedOutcome))
      throw new Error(
        "The agreement must retain each chosen preparedOutcome verbatim in its description.",
      );
  }
  for (const receipt of decisions) {
    if (
      receipt.decision.status === "available" ||
      (receipt.decision.status !== "manual" &&
        decision.agreement.connections?.length)
    )
      continue;
    if (
      !task.manualPlans.some(
        (plan) => plan.proposal.originalOutcome === receipt.decision.operation,
      )
    )
      throw new Error(
        "Save an explicit manual_alternative choice before agreeing a changed outcome.",
      );
  }
}

export const manualInstructions = `When the requested outcome needs a human step or cannot be automated with available capabilities, propose a request-specific manual_alternative before agreeing or writing code. First record a capability for the precise original operation. Reference its current operationId as proposal.capabilityId and copy its operation exactly as originalOutcome. Explain preparedOutcome (what this component CAN do), limitation (what remains unavailable or uncertain), notice (truthful viewer-facing text saying what still needs a person), required fields with their purpose, and concrete human steps. Do not offer a fixed fallback menu. Use [] for fields if none are needed. Ask ordinary questions for essential missing intent before making this proposal. Only the exact saved answer "Use this alternative" selects the displayed plan. Decline or free text requires clarification or a revised proposal; it is not consent. Never silently change a selected plan. Alternatives must be chosen before the immutable service agreement. evidence.manualPlans is the retained source of accepted plans, even when older questions are archived. Retain each chosen preparedOutcome verbatim in the agreement description. Build the prepared outcome, with independent examples proving preparation does not report completion of the original action. Normal service results, draft preparation and component readiness never mark these human steps completed. Only the creator can record a manual result. These are follow-up steps for this saved task, not per-viewer jobs; keep individual submissions in the service's existing durable records when the request needs them.`;
