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
