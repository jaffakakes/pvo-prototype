import { object, choice } from "../tasks/validation.js";

// Only trusted validation messages may enter model feedback. Network/provider errors stay private.
const messages = {
  web_evidence: {
    "Use a completed web_read operation from this task.":
      "Set sourceOperationId to a completed web_read operation from this task, not a search or evidence note.",
    "Research excerpts must appear in the saved page text.":
      "Copy exact contiguous excerpts from the saved page text. Do not paraphrase, join passages with ellipses, or invent text.",
  },
  capability_record: {
    "Use a completed web_evidence operation from this task.":
      "Set evidenceIds to completed web_evidence operation IDs from this task, not web_read IDs. Save valid evidence first.",
    "Use a completed web_read operation from this task.":
      "The cited evidence needs a completed web_read source in this task.",
    "Use a completed connections_read operation from this task.":
      "Set connectionReadId to a completed connections_read operation from this task.",
    "Choose an answered question belonging to this task.":
      "Choose an answered question belonging to this task.",
    "Inspect available connections before deciding external access.":
      "Inspect available connections before deciding external access.",
    "Inspect available accounts again after account setup changes.":
      "Inspect available accounts again after account setup changes.",
    "Inspect the current connection and permissions again.":
      "Inspect the current connection and permissions again.",
    "Research actual integration documentation before deciding support.":
      "Research actual integration documentation before deciding support.",
    "Research must address this exact requested operation.":
      "Use exactly the same operation text as the cited web_evidence assessment.",
    "Unclear support must remain unverified.":
      "Unclear support must remain unverified.",
    "The connected account and installed adapter must permit this operation.":
      "The connected account and installed adapter must permit this operation.",
    "Save the creator's choice before selecting a manual alternative.":
      "Save the creator's choice before selecting a manual alternative.",
    "Documentation has changed; inspect the new evidence before deciding.":
      "Documentation has changed; inspect the new evidence before deciding.",
    "Reuse the chosen outcome until the creator answers again or evidence changes.":
      "Reuse the chosen outcome until the creator answers again or evidence changes.",
  },
};

export function researchFailure(kind, error) {
  const known = messages[kind];
  const message =
    known && Object.hasOwn(known, error?.message) ? known[error.message] : null;
  return message
    ? { kind, status: "rejected", result: { message } }
    : { kind, status: "unavailable", result: null };
}

export function parseResearchRejection(kind, value) {
  choice(kind, Object.keys(messages), "Rejected research kind");
  object(value, ["message"], "Research rejection");
  choice(value.message, Object.values(messages[kind]), "Research correction");
}
