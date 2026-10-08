import { parseComponentServiceConnection } from "../../../../packages/pvo-assistant/attachments/index.js";
import type { ServiceConnectedComponent } from "../../../../packages/pvo-assistant/hosting/index.js";
import {
  ownedProjectReference,
  type TaskProjectLinks,
} from "../assistant/taskProjectLink";
import type { ProjectSnapshot, PvoComponent } from "../project/model";

export type ProjectConnectionReport = {
  ownerId: string;
  projectId: string;
  localId: string;
  title: string;
  services: { serviceId: string; components: ServiceConnectedComponent[] }[];
};

const shortLabel = (value: unknown, fallback: string) => {
  const text =
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const characters = Array.from(text);
  return characters.slice(0, 48).join("") + (characters.length > 48 ? "…" : "");
};
export function componentConnectionLabels(
  sceneName: string,
  component: PvoComponent,
) {
  return {
    sceneName: shortLabel(sceneName, "Untitled scene"),
    componentName: shortLabel(
      component.fields.heading ||
        component.fields.title ||
        component.fields.prompt,
      component.type,
    ),
  };
}

/** Metadata only: never copy source, inputs, credentials or the private task receipt into the index. */
export function projectConnectionReport(
  project: Pick<ProjectSnapshot, "scenes">,
  links: TaskProjectLinks | null,
  localId: string | null,
  ownerId: string | null,
  title: string,
): ProjectConnectionReport | null {
  const owned = ownedProjectReference(links, localId, ownerId);
  if (!owned || !localId) return null;
  const groups = new Map<string, ServiceConnectedComponent[]>();
  for (const scene of project.scenes) {
    for (const component of scene.components) {
      if (!component.serviceConnection) continue;
      const saved = parseComponentServiceConnection(
        component.serviceConnection,
      );
      const identity = saved.receipt.identity;
      if (
        identity.ownerId !== owned.ownerId ||
        identity.projectId !== owned.projectId
      )
        throw new Error(
          "Reconnect this component from its owning project before updating the connection list.",
        );
      const items = groups.get(identity.serviceId) ?? [];
      items.push({
        ...componentConnectionLabels(scene.name, component),
        sceneId: scene.id,
        componentId: component.id,
        releaseId: identity.resourceId,
        operation: saved.connection.operation,
      });
      groups.set(identity.serviceId, items);
    }
  }
  return {
    ...owned,
    localId,
    title,
    services: [...groups].map(([serviceId, components]) => ({
      serviceId,
      components,
    })),
  };
}
