import { maintenanceIssue } from "./issues.js";
import { HOSTED_SERVICE_LIMITS } from "../hosting/index.js";
import { JOB_LIMITS } from "../jobs/index.js";

/** Operational policy consumes sanitized observations, never platform effects or private records. */
export function operationalIssues({
  observedAt,
  connections,
  approvalMissing,
  failures,
  areas,
  pending,
  jobs,
  compute,
  missingReleases,
  missingLive,
}) {
  const issues = [];
  const add = (key, stage, code, message) =>
    issues.push(maintenanceIssue(key, stage, code, message));
  for (const connection of connections) {
    if (
      connection.status !== "connected" ||
      (connection.expiresAt !== null && connection.expiresAt <= observedAt)
    )
      add(
        `connection:${connection.name}`,
        "external_account",
        connection.status === "unavailable"
          ? "connection_unavailable"
          : connection.status === "permission_missing"
            ? "permission_missing"
            : "connection_expired",
        `Account access for ${connection.name} needs attention.`,
      );
    else if (
      connection.expiresAt !== null &&
      connection.expiresAt <= observedAt + 7 * 86400000
    )
      add(
        `connection:${connection.name}`,
        "external_account",
        "connection_expiring",
        `Account access for ${connection.name} expires soon.`,
      );
  }
  if (approvalMissing)
    add(
      "approval",
      "external_account",
      "approval_missing",
      "The published version has no current account approval.",
    );
  for (const failure of failures) {
    const input = ["invalid_input", "action_conflict"].includes(failure.code);
    if (
      ["invalid_input", "invalid_result", "execution_failed"].includes(
        failure.code,
      )
    )
      add(
        failure.key,
        input ? "component_input" : "backend_rule",
        input ? "input_failure" : "backend_failure",
        `A recent ${failure.operation} call failed (${failure.code}). Historical failures may already be resolved.`,
      );
  }
  for (const area of areas) {
    if (
      area.usage.calls >= HOSTED_SERVICE_LIMITS.dailyCalls ||
      area.usage.executions >= HOSTED_SERVICE_LIMITS.dailyExecutions
    )
      add(
        "daily-limit",
        "gateway_validation",
        "daily_limit",
        "This Container reached its daily action allowance.",
      );
    if (
      area.receipts.count >= HOSTED_SERVICE_LIMITS.receipts ||
      area.receipts.bytes >= HOSTED_SERVICE_LIMITS.receiptBytes
    )
      add(
        "saved-limit",
        "gateway_validation",
        "saved_limit",
        "This Container reached its saved-result capacity.",
      );
  }
  if (pending)
    add(
      "outside-action",
      "provider",
      "unresolved_action",
      "A saved outside action has an unresolved outcome.",
    );
  if (jobs.length >= JOB_LIMITS.records)
    add(
      "job-limit",
      "gateway_validation",
      "saved_limit",
      "Background work reached its saved-job capacity.",
    );
  for (const job of jobs)
    if (job.status === "needs_checking")
      add(
        `job:${job.id}`,
        "provider",
        "unresolved_job",
        "A saved background job needs checking.",
      );
  if (compute.state === "unavailable")
    add(
      "compute",
      "provider",
      "compute_unavailable",
      "Compute availability could not be checked.",
    );
  else if (
    compute.capacity.ownerRemaining === 0 ||
    compute.capacity.platformRemaining === 0 ||
    compute.capacity.busySlots === compute.capacity.slots
  )
    add(
      "compute",
      "provider",
      "compute_limit",
      "Compute is currently at its capacity or allowance.",
    );

  for (const releaseId of missingReleases)
    add(
      `release:${releaseId}`,
      "gateway_validation",
      "missing_release",
      "A recorded component points to a missing checked version.",
    );
  if (missingLive)
    add(
      "live-release",
      "gateway_validation",
      "missing_release",
      "The published Container version is missing.",
    );
  return issues;
}
