export const REPAIR_STAGES = Object.freeze([
  "component_input",
  "gateway_validation",
  "backend_rule",
  "external_account",
  "provider",
  "result_display",
  "unknown",
]);
const recovery = {
  connection_expired:
    "Reconnect this account in Connections, then check the original saved action.",
  connection_expiring:
    "Renew this account connection before its access expires.",
  connection_unavailable:
    "Check this account in Connections. Its availability could not be established.",
  permission_missing: "Reconnect the required permission in Connections.",
  approval_missing:
    "Review account access for this checked version before publishing.",
  missing_release:
    "Pause the affected Container and review its saved records. Reconnect and export the affected component to an available checked Container.",
  unresolved_job:
    "Open background work and check the same saved job. Do not submit it again.",
  unresolved_action:
    "Check the original saved outside action before changing versions.",
  daily_limit:
    "Wait for the daily allowance to reset. Keep the original action identity.",
  saved_limit:
    "Review saved records and capacity. Repeating the submission will not free space.",
  compute_unavailable:
    "Refresh compute status before retrying the same action.",
  compute_limit:
    "Wait for compute capacity or its allowance to become available.",
  backend_failure:
    "Reproduce this failure with safe test data before editing code.",
  input_failure:
    "Check the component's fields and operation mapping before changing server rules.",
  no_reproduction:
    "Clarify the failing input or stage. Passing tests alone do not prove the reported problem is fixed.",
};
export function maintenanceIssue(key, stage, code, message) {
  if (!REPAIR_STAGES.includes(stage) || !recovery[code])
    throw new Error("Invalid maintenance issue.");
  return { key, stage, code, message, recovery: recovery[code] };
}
