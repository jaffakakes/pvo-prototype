import { componentConnectionLabels } from "../services/connectionReports";
import {
  matchesComponentServiceRequest,
  parseComponentServiceConnection,
  projectPublicServiceConnection,
  validateServiceBindingFields,
  type PublicServiceConnection,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import {
  sameServiceIdentity,
  type ServiceReleaseIdentity,
} from "../../../../packages/pvo-assistant/releases/index.js";
import type { HostedServiceSummary } from "../../../../packages/pvo-assistant/hosting/index.js";
import { ownedProjectReference } from "../assistant/taskProjectLink";
import {
  prepareComponentTestRecovery,
  type ComponentTestScope,
} from "../components/serviceSubmission";
import type { ExportSnapshot } from "../publishing/model";
import type { CompiledLanguages } from "./manifest";

/** Private delivery scope, kept outside the portable PVO file. */
export type ExportServicePlan = {
  ownerId: string;
  localId: string;
  projectId: string;
  origin: string;
  releases: ServiceReleaseIdentity[];
  connections: {
    serviceId: string;
    components: import("../../../../packages/pvo-assistant/hosting/index.js").ServiceConnectedComponent[];
  }[];
};

export function prepareExportServices(
  snapshot: ExportSnapshot,
  scope: ComponentTestScope,
): ExportServicePlan | undefined {
  const releases = new Map<string, ServiceReleaseIdentity>();
  const connections = new Map<
    string,
    import("../../../../packages/pvo-assistant/hosting/index.js").ServiceConnectedComponent[]
  >();
  for (const scene of snapshot.scenes) {
    for (const component of scene.components) {
      if (!component.serviceConnection) continue;
      const selected = prepareComponentTestRecovery(component, scope);
      if (!selected)
        throw new Error("Reconnect this component before exporting.");
      const identity = selected.connection.receipt.identity;
      const prior = releases.get(identity.serviceId);
      if (prior && !sameServiceIdentity(prior, identity))
        throw new Error(
          "Components use different versions of the same service. Reconnect them before exporting.",
        );
      releases.set(identity.serviceId, identity);
      const components = connections.get(identity.serviceId) ?? [];
      components.push({
        ...componentConnectionLabels(scene.name, component),
        sceneId: scene.id,
        componentId: component.id,
        releaseId: identity.resourceId,
        operation: selected.connection.connection.operation,
      });
      connections.set(identity.serviceId, components);
    }
  }
  if (!releases.size) return undefined;
  const reference = ownedProjectReference(
    scope.assistantTaskLinks,
    scope.localId,
    scope.ownerId,
  );
  if (!reference || !scope.localId)
    throw new Error("This service belongs to another project.");
  return {
    ownerId: reference.ownerId,
    localId: scope.localId,
    projectId: reference.projectId,
    origin: scope.origin,
    releases: [...releases.values()],
    connections: [...connections].map(([serviceId, components]) => ({
      serviceId,
      components,
    })),
  };
}

/** Validate the actual freshly compiled source before packaging public invocation data. */
export function exportServiceConnections(
  snapshot: ExportSnapshot,
  languages: CompiledLanguages,
): Map<string, PublicServiceConnection> {
  const result = new Map<string, PublicServiceConnection>();
  const plan = snapshot.services;
  for (const scene of snapshot.scenes) {
    for (const component of scene.components) {
      if (!component.serviceConnection) continue;
      const saved = parseComponentServiceConnection(
        component.serviceConnection,
      );
      const expected = plan?.releases.find(
        (item) => item.serviceId === saved.receipt.identity.serviceId,
      );
      if (
        !plan ||
        !expected ||
        !sameServiceIdentity(expected, saved.receipt.identity) ||
        plan.ownerId !== expected.ownerId ||
        plan.projectId !== expected.projectId ||
        plan.origin !== saved.origin
      )
        throw new Error(
          "Prepare this connected export from its owning account and project.",
        );
      const compiled = languages.get(component.id)?.compiled;
      const rules = compiled?.rules.filter(
        (rule) =>
          rule.event === saved.connection.event &&
          rule.target === saved.connection.target,
      );
      if (
        !compiled ||
        rules?.length !== 1 ||
        rules[0].action.kind !== "request" ||
        !matchesComponentServiceRequest(saved, rules[0].action)
      )
        throw new Error(
          "This service request changed. Reconnect it before exporting.",
        );
      validateServiceBindingFields(
        saved.connection.input,
        saved.receipt.operation.input,
        compiled.structure,
      );
      if (result.has(component.id))
        throw new Error("Connected component IDs must be unique.");
      result.set(component.id, projectPublicServiceConnection(saved));
    }
  }
  return result;
}

/** Current hosting state is authoritative; a saved attachment receipt is never readiness. */
export function inspectExportService(
  identity: ServiceReleaseIdentity,
  summary: HostedServiceSummary,
  now: number,
): "ready" | "activate" {
  const service = summary.service;
  const release = summary.releases.find(
    (item) => item.identity.resourceId === identity.resourceId,
  );
  if (
    service.identity.ownerId !== identity.ownerId ||
    service.identity.projectId !== identity.projectId ||
    service.identity.serviceId !== identity.serviceId ||
    !release ||
    !sameServiceIdentity(release.identity, identity)
  )
    throw new Error("This export's checked service version is unavailable.");
  if (service.state === "paused" || service.state === "deleted")
    throw new Error(
      "This service is paused or deleted. Review it in Services before sharing.",
    );
  if (
    release.state !== "retained" &&
    (release.state !== "available" || identity.expiresAt <= now)
  )
    throw new Error(
      "This service version expired. Ask the assistant to prepare it again.",
    );
  if (service.liveReleaseId && service.liveReleaseId !== identity.resourceId)
    throw new Error(
      "The service version changed. Reconnect the component before sharing.",
    );
  return service.state === "active" &&
    service.liveReleaseId === identity.resourceId
    ? "ready"
    : "activate";
}
