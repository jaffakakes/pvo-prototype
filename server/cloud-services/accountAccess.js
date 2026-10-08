import {
  object,
  choice,
} from "../../packages/pvo-assistant/tasks/validation.js";
import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import {
  parseServiceAccountAccess,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";
import { ownedHost } from "./ownership.js";

export async function accountCommand(host, kind, input) {
  const ownerId = host.store.service().identity.ownerId;
  const namespace = host.env.ASSISTANT_TASKS;
  if (typeof namespace?.getByName !== "function")
    throw serviceCallError(
      "unavailable",
      "Account connections are unavailable.",
    );
  let result;
  try {
    result = await namespace
      .getByName(`owner:${ownerId}`)
      .manageConnections(ownerId, { kind, input });
  } catch {
    throw serviceCallError(
      "needs_checking",
      "The account request could not be confirmed. Check the same saved action.",
    );
  }
  if (!result.ok)
    throw serviceCallError(
      result.status === 403 ? "forbidden" : "needs_checking",
      result.error,
    );
  return result.value;
}
function publicationFor(host, releaseId) {
  const row = host.store.row(releaseId);
  if (
    !row?.body ||
    !host.store.current(JSON.parse(row.identity), host.now())?.body
  )
    throw serviceCallError(
      "unavailable",
      "This checked version is unavailable.",
    );
  return parseServicePublication(JSON.parse(row.body));
}

/** Explicit creator approval is tied to one checked release's exact account bindings. */
export async function serviceAccountAccess(host, serviceId, ownerId, input) {
  object(input, ["kind", "releaseId"], "Container account access");
  choice(
    input.kind,
    ["inspect", "approve", "revoke"],
    "Account access control",
  );
  if (!/^release-[a-f0-9]{64}$/.test(input.releaseId ?? ""))
    throw new Error("Invalid checked version.");
  const service = ownedHost(host, serviceId, ownerId);
  if (service.state === "deleted")
    throw serviceCallError("unavailable", "This Container is deleted.");
  const publication = publicationFor(host, input.releaseId);
  const bindings = publication.artifact.agreement.connections ?? [];
  if (input.kind === "revoke") {
    host.accounts.revoke(input.releaseId);
    host.calls.cancel(input.releaseId);
  }
  const epoch = host.accounts.epoch();
  const descriptions = [];
  for (const binding of bindings) {
    let connection = null,
      error = null;
    try {
      connection = await accountCommand(host, "service_check", {
        connectionId: binding.connectionId,
        adapter: binding.adapter,
      });
    } catch (failure) {
      error = failure.message;
    }
    descriptions.push({
      name: binding.name,
      operations: binding.operations,
      description: binding.adapter.description,
      permission: binding.adapter.permission,
      method: binding.adapter.method,
      documentation: binding.adapter.documentation,
      repository:
        connection?.scope.provider === "github"
          ? connection.scope.repository
          : connection
            ? `${connection.scope.from} → ${connection.scope.recipient}`
            : null,
      account: connection?.account ?? null,
      error,
      callbackPath:
        binding.adapter.provider === "resend"
          ? `/api/services/${serviceId}/resend/${binding.connectionId}`
          : null,
    });
  }
  const current = ownedHost(host, serviceId, ownerId);
  if (
    current.revision !== service.revision ||
    host.accounts.epoch() !== epoch ||
    !publicationFor(host, input.releaseId)
  )
    throw serviceCallError(
      "state_changed",
      "This Container changed. Refresh its account access.",
    );
  if (input.kind === "approve") {
    if (descriptions.some((item) => item.error))
      throw serviceCallError(
        "forbidden",
        "Connect the required account permissions before approving this version.",
      );
    host.accounts.approve(input.releaseId, bindings, host.now());
  }
  return parseServiceAccountAccess({
    ownerId,
    serviceId,
    releaseId: input.releaseId,
    approved:
      !bindings.length || Boolean(host.accounts.approval(input.releaseId)),
    bindings: descriptions,
  });
}
