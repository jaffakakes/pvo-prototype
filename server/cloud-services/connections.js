import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import {
  parseServiceConnectionReport,
  parseServiceConnections,
  serviceCallError,
  prepareReleaseActivation,
} from "../../packages/pvo-assistant/hosting/index.js";
import { ownedHost } from "./ownership.js";

function availableOwner(host, serviceId, ownerId) {
  const service = ownedHost(host, serviceId, ownerId);
  if (service.state === "deleted")
    throw serviceCallError("unavailable", "This Container has been deleted.");
  return service;
}
export function inspectServiceConnections(host, serviceId, ownerId) {
  const service = availableOwner(host, serviceId, ownerId);
  return parseServiceConnections({
    service,
    observedAt: host.now(),
    records: host.connections.records(),
  });
}
export function reportServiceConnections(host, serviceId, ownerId, value) {
  const service = availableOwner(host, serviceId, ownerId);
  let report;
  try {
    report = parseServiceConnectionReport(value);
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The Container connection report is invalid.",
    );
  }
  if (report.projectId !== service.identity.projectId)
    throw serviceCallError(
      "unavailable",
      "These connections belong to another project.",
    );
  for (const component of report.components) {
    const row = host.store.row(component.releaseId);
    if (!row?.body || (!row.retained && report.kind === "export"))
      throw serviceCallError(
        "unavailable",
        "A connected checked version is unavailable.",
      );
    const publication = parseServicePublication(JSON.parse(row.body));
    if (!row.retained && publication.identity.expiresAt <= host.now())
      throw serviceCallError(
        "unavailable",
        "A connected checked version has expired.",
      );
    if (
      report.kind === "export" &&
      (service.state !== "active" ||
        service.liveReleaseId !== component.releaseId)
    )
      throw serviceCallError(
        "state_changed",
        "The live Container changed before this export was recorded.",
      );
    if (
      !publication.artifact.agreement.operations.some(
        (operation) =>
          operation.name === component.operation &&
          operation.audience === "public",
      )
    )
      throw serviceCallError(
        "forbidden",
        "This operation cannot be recorded as a component connection.",
      );
  }
  host.connections.report(report, host.now());
  return inspectServiceConnections(host, serviceId, ownerId);
}
export function recordServicePublication(
  host,
  serviceId,
  ownerId,
  exportId,
  publication,
) {
  availableOwner(host, serviceId, ownerId);
  host.connections.publication(exportId, publication, host.now());
  return inspectServiceConnections(host, serviceId, ownerId);
}

/** Check every still-retained recorded agreement. Reports never supply schemas or approval. */
export function checkRecordedConnections(host, candidate, state) {
  const checked = new Set();
  for (const record of host.connections.records()) {
    for (const component of record.report.components) {
      if (checked.has(component.releaseId)) continue;
      checked.add(component.releaseId);
      const row = host.store.row(component.releaseId);
      if (!row?.body) continue;
      const agreement = parseServicePublication(JSON.parse(row.body)).artifact
        .agreement;
      prepareReleaseActivation(agreement, candidate, state);
    }
  }
}
