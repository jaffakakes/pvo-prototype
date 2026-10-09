import { operationalIssues } from "../../packages/pvo-assistant/maintenance/index.js";
import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import { ownedHost } from "./ownership.js";
import { accountCommand } from "./accountAccess.js";
import { readNodeUsage } from "./node/usage.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";

/** Private, read-only observation. No viewer inputs, saved data, replies or credentials reach the agent. */
export async function inspectServiceMaintenance(host, serviceId, ownerId) {
  const before = ownedHost(host, serviceId, ownerId);
  if (before.state === "deleted")
    throw serviceCallError("unavailable", "This Container has been deleted.");
  const row = before.liveReleaseId
    ? host.store.row(before.liveReleaseId)
    : null;
  const published = row?.body
    ? parseServicePublication(JSON.parse(row.body))
    : null;
  const bindings =
    published?.artifact.agreement.connections ??
    host.drafts.read()?.content.agreement?.connections ??
    [];
  const connections = await Promise.all(
    bindings.map(async (binding) => {
      try {
        const status = await accountCommand(host, "service_metadata", {
          connectionId: binding.connectionId,
          permission: binding.adapter.permission,
        });
        return { name: binding.name, ...status };
      } catch {
        return {
          name: binding.name,
          id: binding.connectionId,
          status: "unavailable",
          expiresAt: null,
        };
      }
    }),
  );
  const compute = await readNodeUsage(
    host.env.SERVICE_NODE_EXECUTION,
    ownerId,
    serviceId,
  );
  return host.ctx.storage.transactionSync(() => {
    const service = ownedHost(host, serviceId, ownerId);
    if (service.revision !== before.revision || service.state === "deleted")
      throw serviceCallError(
        "state_changed",
        "This Container changed. Refresh its health.",
      );
    const observedAt = host.now();
    const records = host.connections.records();
    const attachments = records.map(({ report, publications }) => ({
      kind: report.kind,
      referenceId: report.referenceId,
      components: report.components
        .slice(0, 8)
        .map(({ componentId, releaseId, operation }) => ({
          componentId,
          releaseId,
          operation,
        })),
      publications: publications.map(({ id }) => id),
    }));
    const missing = new Set();
    for (const record of records)
      for (const component of record.report.components) {
        const referenced = host.store.row(component.releaseId);
        if (
          (!referenced?.body ||
            (!referenced.retained &&
              JSON.parse(referenced.identity).expiresAt <= observedAt)) &&
          !missing.has(component.releaseId)
        ) {
          missing.add(component.releaseId);
        }
      }
    const areas = published
      ? [
          host.actions.records(
            "live",
            published.artifact.agreement.state.initial,
            observedAt,
          ),
        ]
      : [];
    const failures = areas.flatMap((area) =>
      area.failures.map(({ code, at, releaseId, operation }, index) => ({
        key: `failure:${index}`,
        code,
        at,
        releaseId,
        operation,
      })),
    );
    const pending = host.accounts.pending("live");
    const jobs = host.jobs
      .all()
      .map(({ id, status, releaseId, operation, lastError }) => ({
        id,
        status,
        releaseId,
        operation,
        lastError,
      }));
    return {
      ownerId,
      serviceId,
      projectId: service.identity.projectId,
      serviceRevision: service.revision,
      serviceState: service.state,
      liveReleaseId: service.liveReleaseId,
      draftRevision: host.drafts.read()?.revision ?? null,
      observedAt,
      published: published
        ? {
            releaseId: before.liveReleaseId,
            agreement: published.artifact.agreement,
            source: published.artifact.package,
          }
        : null,
      releases: host.store.rows().map((row) => ({
        releaseId: row.id,
        available: !!row.body,
        retained: !!row.retained,
      })),
      attachments,
      connections,
      failures,
      jobs,
      issues: operationalIssues({
        observedAt,
        connections,
        approvalMissing: !!(
          published &&
          bindings.length &&
          !host.accounts.approval(before.liveReleaseId)
        ),
        failures,
        areas,
        pending: !!pending,
        jobs,
        compute,
        missingReleases: [...missing],
        missingLive: !!before.liveReleaseId && !published,
      }),
    };
  });
}
