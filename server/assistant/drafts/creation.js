import { withAssistantDeadline } from "../deadline.js";
import { HttpError } from "../../http.js";
import { parseServiceDraft } from "../../../packages/pvo-assistant/services/index.js";

export async function consumeDraftRpc(call) {
  const raw = await call;
  try {
    const { [Symbol.dispose]: dispose, ...value } = raw;
    return structuredClone(value);
  } finally {
    raw?.[Symbol.dispose]?.();
  }
}
export const draftHost = (coordinator, serviceId) => {
  if (!coordinator.env.SERVICE_HOSTS?.getByName)
    throw new HttpError(503, "Containers are unavailable.");
  return coordinator.env.SERVICE_HOSTS.getByName(serviceId);
};
export async function prepareDraftTaskCreation(coordinator, ownerId, input) {
  const target = input.context.container;
  if (!target) return null;
  // An exact creation replay must recover its original snapshot even after later edits.
  const existing = coordinator.ctx.storage.sql
    .exec("SELECT id FROM tasks WHERE operation_id=?", input.operationId)
    .toArray()[0];
  if (existing) return null;
  const service = coordinator.services.service(target.serviceId);
  if (
    !service ||
    service.identity.ownerId !== ownerId ||
    service.identity.projectId !== input.projectId ||
    service.state === "deleted"
  )
    throw new HttpError(404, "This Container is unavailable.");
  const result = await consumeDraftRpc(
    draftHost(coordinator, target.serviceId).readDraft(
      target.serviceId,
      ownerId,
    ),
  );
  if (!result.ok) throw new HttpError(result.status, result.error);
  const draft = parseServiceDraft(result.value);
  if (draft.revision !== target.revision)
    throw new HttpError(
      409,
      "Save or reload the latest draft before asking the AI to edit it.",
    );
  return draft;
}
export async function reconcileDraftStops(coordinator) {
  for (const entry of coordinator.drafts
    .pendingStops()
    .filter((entry) => entry.stopPending.nextAt <= coordinator.now())
    .slice(0, 2)) {
    try {
      const { serviceId, ownerId } = entry.draft.identity;
      const result =
        entry.stopPending.expiresAt <= coordinator.now()
          ? { ok: true }
          : await withAssistantDeadline(
              () =>
                consumeDraftRpc(
                  draftHost(coordinator, serviceId).stopDraftTask(
                    serviceId,
                    ownerId,
                    entry.taskId,
                  ),
                ),
              coordinator.providerTimeoutMs(),
            );
      if (!result.ok) throw new Error("Stop fence is unconfirmed.");
      await coordinator.transaction(() => {
        const current = coordinator.drafts.get(entry.taskId);
        if (current) {
          current.stopPending = false;
          coordinator.drafts.write(entry.taskId, current);
        }
      });
    } catch {
      await coordinator.transaction(() => {
        const current = coordinator.drafts.get(entry.taskId);
        if (!current?.stopPending) return;
        current.stopPending.attempts++;
        current.stopPending.nextAt = Math.min(
          current.stopPending.expiresAt,
          coordinator.now() +
            Math.min(
              30000,
              1000 * 2 ** Math.min(5, current.stopPending.attempts),
            ),
        );
        coordinator.drafts.write(entry.taskId, current);
      });
    }
  }
}
