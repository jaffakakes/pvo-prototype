import {
  inspectExportService,
  type ExportServicePlan,
} from "../../domain/export/serviceDelivery";
import type { HostedServiceSummary } from "../../../../packages/pvo-assistant/hosting/index.js";
import type { PendingControl } from "../../infrastructure/services/client";

export type ExportActivationContext = {
  signal: AbortSignal;
  isCurrent(): boolean;
};
export type ExportActivationAdapters = {
  read(
    serviceId: string,
    ownerId: string,
    signal: AbortSignal,
  ): Promise<HostedServiceSummary>;
  send(
    pending: PendingControl,
    ownerId: string,
    signal: AbortSignal,
  ): Promise<HostedServiceSummary>;
  pending(ownerId: string, serviceId: string): PendingControl | null;
  save(ownerId: string, serviceId: string, value: PendingControl | null): void;
  createId(): string;
  now(): number;
};

/** One gate for rendered-file readiness, download and publication. Never rolls back a live service. */
export async function activateExportServices(
  plan: ExportServicePlan | undefined,
  adapters: ExportActivationAdapters,
  context: ExportActivationContext,
): Promise<void> {
  const check = () => {
    context.signal.throwIfAborted();
    if (!context.isCurrent())
      throw new DOMException(
        "Export account or project changed.",
        "AbortError",
      );
  };
  check();
  if (!plan) return;
  // Check the entire frozen plan before activating any service.
  const observations: HostedServiceSummary[] = [];
  for (const identity of plan.releases) {
    check();
    if (
      identity.ownerId !== plan.ownerId ||
      identity.projectId !== plan.projectId
    )
      throw new Error("This export belongs to another service owner.");
    const summary = await adapters.read(
      identity.serviceId,
      plan.ownerId,
      context.signal,
    );
    check();
    inspectExportService(identity, summary, adapters.now());
    observations.push(summary);
  }
  for (const [index, identity] of plan.releases.entries()) {
    check();
    const summary = observations[index];
    if (inspectExportService(identity, summary, adapters.now()) === "ready") {
      adapters.save(plan.ownerId, identity.serviceId, null);
      continue;
    }
    const pending = adapters.pending(plan.ownerId, identity.serviceId) ?? {
      serviceId: identity.serviceId,
      control: {
        kind: "activate" as const,
        actionId: adapters.createId(),
        expectedRevision: summary.service.revision,
        releaseId: identity.resourceId,
      },
    };
    if (
      pending.serviceId !== identity.serviceId ||
      pending.control.kind !== "activate" ||
      pending.control.releaseId !== identity.resourceId ||
      pending.control.expectedRevision !== summary.service.revision
    )
      throw new Error(
        "An earlier activation needs review in Services before this export can continue.",
      );
    // Storage must commit before dispatch. A lost reply keeps the exact retry identity.
    adapters.save(plan.ownerId, identity.serviceId, pending);
    check();
    const activated = await adapters.send(
      pending,
      plan.ownerId,
      context.signal,
    );
    check();
    if (inspectExportService(identity, activated, adapters.now()) !== "ready")
      throw new Error("The service is not ready. Retry this export.");
    adapters.save(plan.ownerId, identity.serviceId, null);
  }
  check();
}
