import { parseDraftCreation } from "./drafts.js";
import { contentDigest } from "../contentDigest.js";
import {
  parseHostedSummary,
  parseServiceControl,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";
import { withAssistantDeadline } from "../assistant/deadline.js";
import { taskId } from "../assistant/tasks/input.js";
import { hostedReply } from "./rpcReply.js";

async function hostResult(call) {
  const raw = await withAssistantDeadline(call, 5000);
  try {
    const { [Symbol.dispose]: dispose, ...result } = raw;
    if (!result.ok) return result;
    return { ok: true, value: structuredClone(result.value) };
  } finally {
    raw?.[Symbol.dispose]?.();
  }
}
function stub(coordinator, id) {
  if (typeof coordinator.env.SERVICE_HOSTS?.getByName !== "function")
    throw serviceCallError("unavailable", "Hosted services are unavailable.");
  return coordinator.env.SERVICE_HOSTS.getByName(id);
}
async function refreshOne(coordinator, metadata) {
  const { serviceId, ownerId } = metadata.identity;
  try {
    const result = await hostResult(() =>
      stub(coordinator, serviceId).inspect(serviceId, ownerId),
    );
    if (!result.ok) return { metadata, summary: null };
    const summary = parseHostedSummary(result.value);
    await coordinator.transaction(() =>
      coordinator.services.synchronize(summary, coordinator.now()),
    );
    return { metadata: coordinator.services.service(serviceId), summary };
  } catch {
    // A missing or unavailable host is not evidence that its pending publication was deleted.
    return { metadata, summary: null };
  }
}
export async function refreshOwnedServices(coordinator) {
  return Promise.all(
    coordinator.services
      .services()
      .filter((item) => item.state !== "deleted")
      .map((item) => refreshOne(coordinator, item)),
  );
}
/** The owner catalog is an index; the single hosted object commits lifecycle and control receipt atomically. */
export async function manageHostedServices(coordinator, ownerId, operation) {
  return hostedReply(async () => {
    taskId(ownerId);
    coordinator.repository.bindOwner(ownerId);
    if (operation.kind === "create") {
      const input = parseDraftCreation(operation.input);
      try {
        coordinator.repository.requireProject(input.projectId);
      } catch {
        throw serviceCallError("unavailable", "This project is unavailable.");
      }
      const serviceId = `service-${await contentDigest(JSON.stringify([ownerId, input.projectId, "draft", input.actionId]))}`;
      const digest = await contentDigest(JSON.stringify(input));
      const metadata = await coordinator.transaction(() =>
        coordinator.services.create(
          { serviceId, ownerId, projectId: input.projectId },
          input.description,
          digest,
          coordinator.now(),
        ),
      );
      if (metadata.state === "deleted")
        throw serviceCallError(
          "unavailable",
          "This Container has been deleted.",
        );
      const result = await hostResult(() =>
        stub(coordinator, serviceId).initializeDraft(
          metadata.identity,
          input.description,
        ),
      );
      if (!result.ok) return { draftResult: result };
      return { metadata, draft: result.value };
    }
    if (operation.kind === "list")
      return {
        services: (await refreshOwnedServices(coordinator)).filter(
          (item) => item.metadata.state !== "deleted",
        ),
      };
    taskId(operation.id);
    const metadata = coordinator.services.service(operation.id);
    if (!metadata || metadata.identity.ownerId !== ownerId)
      throw serviceCallError("unavailable", "This service is unavailable.");
    if (operation.kind === "read") return refreshOne(coordinator, metadata);
    if (operation.kind === "records") {
      const result = await hostResult(() =>
        stub(coordinator, operation.id).records(operation.id, ownerId),
      );
      if (!result.ok) return { control: result };
      return result.value;
    }
    if (operation.kind === "operations" || operation.kind === "attachment") {
      const result = await hostResult(() =>
        operation.kind === "operations"
          ? stub(coordinator, operation.id).operations(operation.id, ownerId)
          : stub(coordinator, operation.id).attachment(
              operation.id,
              ownerId,
              operation.input,
            ),
      );
      if (!result.ok) return { control: result };
      return result.value;
    }
    if (operation.kind === "readDraft" || operation.kind === "saveDraft") {
      const result = await hostResult(() =>
        operation.kind === "readDraft"
          ? stub(coordinator, operation.id).readDraft(operation.id, ownerId)
          : stub(coordinator, operation.id).saveDraft(
              operation.id,
              ownerId,
              operation.input,
            ),
      );
      return { draftResult: result };
    }

    if (operation.kind !== "control")
      throw serviceCallError(
        "invalid_input",
        "This service control is unavailable.",
      );
    let control;
    try {
      control = parseServiceControl(operation.input);
    } catch {
      throw serviceCallError(
        "invalid_input",
        "The service control is invalid.",
      );
    }
    const result = await hostResult(() =>
      stub(coordinator, operation.id).control(operation.id, ownerId, control),
    );
    if (!result.ok) return { control: result };
    const summary = parseHostedSummary(result.value.summary);
    // Never misreport a committed control as failed because a secondary index update failed.
    try {
      await coordinator.transaction(() =>
        coordinator.services.synchronize(summary, coordinator.now()),
      );
    } catch {
      console.error("Hosted service catalog refresh failed", operation.id);
    }
    return {
      control: { ok: true, value: { receipt: result.value.receipt, summary } },
    };
  });
}
