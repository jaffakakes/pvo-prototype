import { maintenanceIssue } from "../../packages/pvo-assistant/maintenance/index.js";
import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import { HOSTED_SERVICE_LIMITS } from "../../packages/pvo-assistant/hosting/index.js";
import { JOB_LIMITS } from "../../packages/pvo-assistant/jobs/index.js";
import { ownedHost } from "./ownership.js";
import { accountCommand } from "./accountAccess.js";
import { readNodeUsage } from "./node/usage.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";

/** Private, read-only observation. No viewer inputs, saved data, replies or credentials reach the agent. */
export async function inspectServiceMaintenance(host, serviceId, ownerId) {
  const before = ownedHost(host, serviceId, ownerId);
  if (before.state === "deleted") throw serviceCallError("unavailable", "This Container has been deleted.");
  const row = before.liveReleaseId ? host.store.row(before.liveReleaseId) : null;
  const published = row?.body ? parseServicePublication(JSON.parse(row.body)) : null;
  const bindings = published?.artifact.agreement.connections ?? host.drafts.read()?.content.agreement?.connections ?? [];
  const connections = await Promise.all(bindings.map(async (binding) => {
    try {
      const status = await accountCommand(host, "service_metadata", { connectionId: binding.connectionId, permission: binding.adapter.permission });
      return { name: binding.name, ...status };
    } catch {
      return { name: binding.name, id: binding.connectionId, status: "unavailable", expiresAt: null };
    }
  }));
  const compute = await readNodeUsage(host.env.SERVICE_NODE_EXECUTION, ownerId, serviceId);
  return host.ctx.storage.transactionSync(() => {
    const service = ownedHost(host, serviceId, ownerId);
    if (service.revision !== before.revision || service.state === "deleted") throw serviceCallError("state_changed", "This Container changed. Refresh its health.");
    const observedAt = host.now(), issues = [];
    const add = (key, stage, code, message) => issues.push(maintenanceIssue(key, stage, code, message));
    for (const connection of connections) {
      if (connection.status !== "connected" || (connection.expiresAt !== null && connection.expiresAt <= observedAt)) add(`connection:${connection.name}`, "external_account", connection.status === "unavailable" ? "connection_unavailable" : connection.status === "permission_missing" ? "permission_missing" : "connection_expired", `Account access for ${connection.name} needs attention.`);
      else if (connection.expiresAt !== null && connection.expiresAt <= observedAt + 7 * 86400000) add(`connection:${connection.name}`, "external_account", "connection_expiring", `Account access for ${connection.name} expires soon.`);
    }
    if (published && bindings.length && !host.accounts.approval(before.liveReleaseId)) add("approval", "external_account", "approval_missing", "The published version has no current account approval.");
    const records = host.connections.records();
    const attachments = records.map(({report, publications}) => ({ kind: report.kind, referenceId: report.referenceId, components: report.components.slice(0,8).map(({componentId, releaseId, operation}) => ({componentId, releaseId, operation})), publications: publications.map(({id}) => id) }));
    const missing = new Set();
    for (const record of records) for (const component of record.report.components) {
      const referenced = host.store.row(component.releaseId);
      if ((!referenced?.body || (!referenced.retained && JSON.parse(referenced.identity).expiresAt <= observedAt)) && !missing.has(component.releaseId)) { missing.add(component.releaseId); add(`release:${component.releaseId}`, "gateway_validation", "missing_release", "A recorded component points to a missing checked version."); }
    }
    if (before.liveReleaseId && !published) add("live-release", "gateway_validation", "missing_release", "The published Container version is missing.");
    const areas = published ? [host.actions.records("live", published.artifact.agreement.state.initial, observedAt)] : [];
    const failures = areas.flatMap(area => area.failures.map(({code,at,releaseId,operation}, index) => ({key:`failure:${index}`,code,at,releaseId,operation})));
    for (const failure of failures) {
      const input = ["invalid_input","action_conflict"].includes(failure.code);
      if (["invalid_input","invalid_result","execution_failed"].includes(failure.code)) add(failure.key, input ? "component_input" : "backend_rule", input ? "input_failure" : "backend_failure", `A recent ${failure.operation} call failed (${failure.code}). Historical failures may already be resolved.`);
    }
    for (const area of areas) {
      if (area.usage.calls >= HOSTED_SERVICE_LIMITS.dailyCalls || area.usage.executions >= HOSTED_SERVICE_LIMITS.dailyExecutions) add("daily-limit", "gateway_validation", "daily_limit", "This Container reached its daily action allowance.");
      if (area.receipts.count >= HOSTED_SERVICE_LIMITS.receipts || area.receipts.bytes >= HOSTED_SERVICE_LIMITS.receiptBytes) add("saved-limit", "gateway_validation", "saved_limit", "This Container reached its saved-result capacity.");
    }
    const pending = host.accounts.pending("live");
    if (pending) add("outside-action", "provider", "unresolved_action", "A saved outside action has an unresolved outcome.");
    const jobs = host.jobs.all().map(({id,status,releaseId,operation,lastError}) => ({id,status,releaseId,operation,lastError}));
    if (jobs.length >= JOB_LIMITS.records) add("job-limit", "gateway_validation", "saved_limit", "Background work reached its saved-job capacity.");
    for (const job of jobs) if (job.status === "needs_checking") add(`job:${job.id}`, "provider", "unresolved_job", "A saved background job needs checking.");
    if (compute.state === "unavailable") add("compute", "provider", "compute_unavailable", "Compute availability could not be checked.");
    else if (compute.capacity.ownerRemaining === 0 || compute.capacity.platformRemaining === 0 || compute.capacity.busySlots === compute.capacity.slots) add("compute", "provider", "compute_limit", "Compute is currently at its capacity or allowance.");
    return { ownerId, serviceId, projectId:service.identity.projectId, serviceRevision:service.revision, draftRevision:host.drafts.read()?.revision ?? null, observedAt, published: published ? {releaseId:before.liveReleaseId, agreement:published.artifact.agreement, source:published.artifact.package} : null, releases:host.store.rows().map(row=>({releaseId:row.id, available:!!row.body, retained:!!row.retained})), attachments, connections, failures, jobs, issues };
  });
}
