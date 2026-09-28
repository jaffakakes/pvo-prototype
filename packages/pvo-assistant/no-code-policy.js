import { AssistantPolicyError } from "./policy.js";

function requireAdvanced() {
  throw new AssistantPolicyError("advanced_required", "Enable Advanced for this logic change.");
}

/** The switch limits behavior only. Appearance and wording use the normal PVO rules. */
export function validateNoCodeAssistantProposal(original, proposed) {
  const local = action => ["continue", "time", "scene"].includes(action.kind);
  const matching = (rules, rule) => rules.find(item => item.event === rule.event && item.target === rule.target);
  const equal = (before, after) => JSON.stringify(before?.action) === JSON.stringify(after?.action);
  for (const rule of proposed.rules) {
    if (!local(rule.action) && !equal(matching(original.rules, rule), rule)) requireAdvanced();
  }
  // Hiding Advanced must preserve existing authored behavior, including request branches.
  for (const rule of original.rules) {
    if (!local(rule.action) && !equal(rule, matching(proposed.rules, rule))) requireAdvanced();
  }
}
