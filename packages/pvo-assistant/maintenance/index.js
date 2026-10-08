import { object, choice, text, list, requireTask } from "../tasks/validation.js";

export const REPAIR_STAGES = Object.freeze(["component_input", "gateway_validation", "backend_rule", "external_account", "provider", "result_display", "unknown"]);
const recovery = {
  connection_expired: "Reconnect this account in Connections, then check the original saved action.",
  connection_expiring: "Renew this account connection before its access expires.",
  connection_unavailable: "Check this account in Connections. Its availability could not be established.",
  permission_missing: "Reconnect the required permission in Connections.",
  approval_missing: "Review account access for this checked version before publishing.",
  missing_release: "Pause the affected Container and review its saved records. Reconnect and export the affected component to an available checked Container.",
  unresolved_job: "Open background work and check the same saved job. Do not submit it again.",
  unresolved_action: "Check the original saved outside action before changing versions.",
  daily_limit: "Wait for the daily allowance to reset. Keep the original action identity.",
  saved_limit: "Review saved records and capacity. Repeating the submission will not free space.",
  compute_unavailable: "Refresh compute status before retrying the same action.",
  compute_limit: "Wait for compute capacity or its allowance to become available.",
  backend_failure: "Reproduce this failure with safe test data before editing code.",
  input_failure: "Check the component's fields and operation mapping before changing server rules.",
  no_reproduction: "Clarify the failing input or stage. Passing tests alone do not prove the reported problem is fixed.",
};
export function maintenanceIssue(key, stage, code, message) {
  if (!REPAIR_STAGES.includes(stage) || !recovery[code]) throw new Error("Invalid maintenance issue.");
  return { key, stage, code, message, recovery: recovery[code] };
}
export function parseRepairDiagnosis(value, evidence) {
  object(value, ["kind", "stage", "evidenceKeys", "summary"], "Repair diagnosis");
  requireTask(value.kind === "diagnose", "Choose a diagnosis.");
  choice(value.stage, REPAIR_STAGES, "Failing stage");
  text(value.summary, 1024, "Diagnosis");
  list(value.evidenceKeys, 8, "Diagnosis evidence");
  requireTask(value.evidenceKeys.length > 0, "Cite observed evidence before making a repair.");
  for (const key of value.evidenceKeys) {
    const observed = evidence.find((item) => item.key === key);
    requireTask(!!observed && observed.stage === value.stage, "The diagnosis must match observed evidence.");
  }
  return structuredClone(value);
}
export function repairEvidence(maintenance) {
  const result = [...maintenance.snapshot.issues];
  const baseline = maintenance.baseline;
  if (baseline?.status === "failed") result.push(maintenanceIssue("baseline", "backend_rule", "backend_failure", "The saved draft failed its safe baseline checks."));
  if (baseline?.status === "passed") result.push(maintenanceIssue("baseline", "unknown", "no_reproduction", "The saved draft passed its safe baseline checks."));
  return result;
}
export function requireRepairEdit(state) {
  const maintenance = state.maintenance;
  if (!maintenance) return;
  requireTask(maintenance.baseline?.status === "failed" && maintenance.diagnosis?.stage === "backend_rule", "Only a reproduced backend failure permits code repair. Resolve account, input or provider problems at their owning boundary.");
}

/** Browser admission of the small status projection; source and diagnostics stay on the private server. */
export function parseMaintenanceSnapshot(value, ownerId, serviceId) {
  requireTask(value?.ownerId === ownerId && value?.serviceId === serviceId, "The Container account changed.");
  requireTask(Number.isSafeInteger(value.observedAt) && Number.isSafeInteger(value.serviceRevision), "Invalid health observation.");
  list(value.issues, 256, "Container health");
  for (const issue of value.issues) {
    object(issue, ["key","stage","code","message","recovery"], "Health issue");
    choice(issue.stage, REPAIR_STAGES, "Failing stage");
    for (const key of ["key","code","message","recovery"]) text(issue[key], 1024, key);
  }
  return {ownerId,serviceId,projectId:value.projectId,serviceRevision:value.serviceRevision,draftRevision:value.draftRevision,observedAt:value.observedAt,issues:structuredClone(value.issues)};
}
export function parseRepairReport(value) {
  if (value === null) return null;
  object(value,["stage","summary","baseline","checkedRevision","published","outcome","dependencies","observedAt"],"Repair report");
  choice(value.stage,REPAIR_STAGES,"Failing stage");
  choice(value.baseline,["unrun","failed","passed"],"Baseline");
  requireTask(value.published === false && (value.checkedRevision === null || Number.isSafeInteger(value.checkedRevision)) && Number.isSafeInteger(value.observedAt),"Invalid repair evidence.");
  text(value.summary,1024,"Diagnosis"); text(value.outcome,1024,"Outcome");
  list(value.dependencies,8,"Dependencies");
  for (const dependency of value.dependencies) { object(dependency,["message","recovery"],"Dependency"); text(dependency.message,1024,"Message"); text(dependency.recovery,1024,"Recovery"); }
  return structuredClone(value);
}
