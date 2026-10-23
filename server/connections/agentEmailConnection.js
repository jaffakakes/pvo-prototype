import { HttpError } from "../http.js";
import { ConnectionAccessError } from "./accessError.js";
import { connectionGrant } from "./grants.js";
import { connectionScopeKey } from "../../packages/pvo-assistant/connections/index.js";

/** Sending approvals reference a ready identity; they never copy its private key. */
function source(manager) {
  const channel =
    manager.coordinator.agentIdentity.store.get("agentmail")?.channel;
  if (channel?.status !== "ready" || !channel.connectionId)
    throw new ConnectionAccessError();
  const current = manager.get(channel.connectionId);
  if (
    current.connection.status !== "connected" ||
    !current.connection.permissions.includes("identity:receive") ||
    current.details.scope.resourceId !== channel.resourceId
  )
    throw new ConnectionAccessError();
  return current;
}
export function agentEmailSourceValid(manager, current) {
  const saved = current.details.identitySource;
  if (!saved) return true;
  try {
    const active = source(manager);
    return active.id === saved.id && active.revision === saved.revision;
  } catch {
    return false;
  }
}
export async function agentEmailSecret(manager, ownerId, current) {
  if (
    current.connection.status !== "connected" ||
    !agentEmailSourceValid(manager, current)
  )
    throw new ConnectionAccessError();
  const active = source(manager);
  const key = await manager.secret(ownerId, active);
  if (!agentEmailSourceValid(manager, current))
    throw new ConnectionAccessError();
  return JSON.stringify({ key, inboxId: active.details.scope.resourceId });
}
export async function connectAgentEmail(manager, ownerId, input) {
  const previous = manager.catalog.get(input.id);
  if ((previous?.revision ?? 0) !== input.expectedRevision)
    throw new HttpError(
      409,
      "This connection changed. Refresh before approving email sending.",
    );
  if (
    previous &&
    connectionScopeKey(manager.get(input.id).details.scope) !==
      connectionScopeKey(input.setup)
  )
    throw new HttpError(
      409,
      "Approve a separate connection for a different recipient.",
    );
  const active = source(manager);
  const identitySource = { id: active.id, revision: active.revision };
  const key = await manager.secret(ownerId, active);
  if (!agentEmailSourceValid(manager, { details: { identitySource } }))
    throw new ConnectionAccessError();
  const verified = await manager.coordinator
    .connectionProvider()
    .verify(
      input.setup,
      JSON.stringify({ key, inboxId: active.details.scope.resourceId }),
    );
  const revision = input.expectedRevision + 1;
  manager.coordinator.ctx.storage.transactionSync(() => {
    if (
      (manager.catalog.get(input.id)?.revision ?? 0) !==
        input.expectedRevision ||
      !agentEmailSourceValid(manager, { details: { identitySource } })
    )
      throw new HttpError(
        409,
        "The saved identity changed. Refresh before approving email sending.",
      );
    manager.catalog.save(
      {
        id: input.id,
        ...connectionGrant(input.setup, verified.login),
        provider: "agentmail",
        status: "connected",
        revision,
      },
      input.expectedRevision,
    );
    manager.store.save(
      input.id,
      revision,
      { ...verified, identitySource, checkedAt: manager.coordinator.now() },
      null,
    );
  });
  return manager.public(manager.get(input.id));
}
