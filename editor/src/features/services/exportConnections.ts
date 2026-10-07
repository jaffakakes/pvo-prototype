import type { CompletedExport } from "../../domain/publishing/model";
import {
  sendContainerConnections,
  sendContainerPublication,
} from "../../infrastructure/services/connections";

/** A frozen export is recorded before delivery; retries preserve its identity and dependency list. */
export async function recordExportConnections(
  artifact: CompletedExport,
  signal: AbortSignal,
  check: () => void,
) {
  const plan = artifact.services;
  if (!plan) return;
  for (const connection of plan.connections) {
    check();
    await sendContainerConnections(
      plan.ownerId,
      connection.serviceId,
      {
        kind: "export",
        referenceId: artifact.snapshotId,
        projectId: plan.projectId,
        title: artifact.filename,
        expectedRevision: 0,
        components: connection.components,
      },
      signal,
    );
    check();
  }
}
/** The server independently checks that this account owns a ready published PVO. */
export async function recordPublishedConnections(
  artifact: CompletedExport,
  publicationId: string,
  signal: AbortSignal,
  check: () => void,
) {
  const plan = artifact.services;
  if (!plan) return;
  for (const { serviceId } of plan.connections) {
    check();
    await sendContainerPublication(
      plan.ownerId,
      serviceId,
      artifact.snapshotId,
      publicationId,
      signal,
    );
    check();
  }
}
