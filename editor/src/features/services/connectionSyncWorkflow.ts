import type { ProjectConnectionReport } from "../../domain/services/connectionReports";
import type {
  ServiceConnections,
  ServiceConnectionReport,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import type { ManagedService } from "../../infrastructure/services/client";

type Adapters = {
  flush(): Promise<void>;
  list(ownerId: string, signal: AbortSignal): Promise<ManagedService[]>;
  read(
    ownerId: string,
    serviceId: string,
    signal: AbortSignal,
  ): Promise<ServiceConnections>;
  send(
    ownerId: string,
    serviceId: string,
    value: ServiceConnectionReport,
    signal: AbortSignal,
  ): Promise<ServiceConnections>;
};
/** Local saves precede dependency reports. Every asynchronous boundary checks account/project freshness. */
export async function syncProjectConnections(
  report: ProjectConnectionReport,
  adapters: Adapters,
  context: { signal: AbortSignal; isCurrent(): boolean },
) {
  const check = () => {
    context.signal.throwIfAborted();
    if (!context.isCurrent())
      throw new DOMException("Project or account changed.", "AbortError");
  };
  check();
  await adapters.flush();
  check();
  const services = await adapters.list(report.ownerId, context.signal);
  check();
  for (const item of services) {
    if (
      item.metadata.identity.projectId !== report.projectId ||
      item.metadata.state === "deleted"
    )
      continue;
    const serviceId = item.metadata.identity.serviceId;
    const current = await adapters.read(
      report.ownerId,
      serviceId,
      context.signal,
    );
    check();
    const previous = current.records.find(
      (record) => record.report.kind === "project",
    );
    const components =
      report.services.find((service) => service.serviceId === serviceId)
        ?.components ?? [];
    if (!previous && !components.length) continue;
    if (
      previous &&
      previous.report.title === report.title &&
      JSON.stringify(previous.report.components) === JSON.stringify(components)
    )
      continue;
    await adapters.send(
      report.ownerId,
      serviceId,
      {
        kind: "project",
        referenceId: report.projectId,
        projectId: report.projectId,
        title: report.title,
        expectedRevision: previous?.revision ?? 0,
        components,
      },
      context.signal,
    );
    check();
  }
}
