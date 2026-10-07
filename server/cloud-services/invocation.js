import {
  parseServiceAction,
  serializeServiceAction,
  serviceCallScope,
  prepareHostedInvocation,
  checkedHostedReply,
  replayServiceAction,
  serviceCallError,
} from "../../packages/pvo-assistant/hosting/index.js";
import { parseServicePublication } from "../../packages/pvo-assistant/releases/index.js";
import { contentDigest } from "../contentDigest.js";

function available(host, serviceId, authority) {
  const service = host.store.service();
  if (!service || service.identity.serviceId !== serviceId)
    throw serviceCallError("unavailable", "This service is unavailable.");
  const requested =
    authority.kind === "component_test"
      ? host.store.row(authority.releaseId)
      : null;
  return {
    service,
    scope: serviceCallScope(
      service,
      authority,
      !!(requested?.body && requested.retained),
    ),
  };
}
/** The route owns authority. Generated code receives only its validated invocation and never saves state itself. */
export async function invokeHostedAction(host, serviceId, authority, value) {
  available(host, serviceId, authority);
  let action;
  try {
    action = parseServiceAction(value);
  } catch {
    throw serviceCallError(
      "invalid_input",
      "The action does not match this service.",
    );
  }
  const digest = await contentDigest(serializeServiceAction(action));
  return host.calls.run(async () => {
    const { service, scope } = available(host, serviceId, authority);
    const now = host.now(),
      row = host.store.row(scope.releaseId);
    const current = row
      ? host.store.current(JSON.parse(row.identity), now)
      : null;
    host.cleanupDeletedReleases();
    if (!current || current.body === null)
      throw serviceCallError("unavailable", "This release is unavailable.");
    const publication = parseServicePublication(JSON.parse(row.body));
    const namespace =
      scope.namespace === "test" ? `test:${scope.releaseId}` : "live";
    try {
      host.actions.admit(namespace, now);
      const prior = replayServiceAction(
        host.actions.receipt(namespace, action.actionId),
        action,
        digest,
        scope.audience,
      );
      if (prior) return prior;
      const snapshot = host.actions.data(
        namespace,
        publication.artifact.agreement.state.initial,
      );
      const invocation = prepareHostedInvocation(
        publication.artifact.agreement,
        action,
        snapshot.state,
        now,
        scope.audience,
      );
      host.actions.admit(namespace, now, true);
      const controller = new AbortController();
      host.calls.active = { resourceId: scope.releaseId, controller };
      try {
        const reply = checkedHostedReply(
          publication.artifact.agreement,
          invocation,
          await host.executePackage(
            publication.artifact.package,
            invocation,
            controller.signal,
          ),
        );
        return host.ctx.storage.transactionSync(() => {
          const fresh = available(host, serviceId, authority);
          if (
            fresh.service.revision !== service.revision ||
            fresh.scope.releaseId !== scope.releaseId ||
            host.store.current(publication.identity, host.now())?.body === null
          )
            throw serviceCallError(
              "state_changed",
              "This service changed. Retry the same action.",
            );
          const receipt = {
            actionId: action.actionId,
            operation: action.operation,
            inputDigest: digest,
            audience: publication.artifact.agreement.operations.find(
              (item) => item.name === action.operation,
            ).audience,
            releaseId: scope.releaseId,
            result: reply.result,
            createdAt: host.now(),
          };
          host.actions.commit(
            namespace,
            snapshot.version,
            reply.state,
            receipt,
          );
          return { actionId: action.actionId, result: reply.result };
        });
      } finally {
        if (host.calls.active?.controller === controller)
          host.calls.active = null;
      }
    } catch (error) {
      // Diagnostics cannot replace a call's outcome or resurrect removed records.
      try {
        if (
          host.store.service()?.state !== "deleted" &&
          host.store.row(scope.releaseId)?.body
        )
          host.ctx.storage.transactionSync(() =>
            host.actions.failure(
              namespace,
              action,
              scope.releaseId,
              error?.code,
              host.now(),
            ),
          );
      } catch {
        console.error(
          "Service failure diagnostic could not be saved",
          serviceId,
        );
      }
      throw error;
    }
  });
}
