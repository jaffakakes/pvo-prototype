import { canonicalJson } from "../../packages/pvo-assistant/services/json.js";
import { serviceCallError } from "../../packages/pvo-assistant/hosting/index.js";
import { executeConnectedOperation } from "./connectedExecution.js";
import { accountCommand } from "./accountAccess.js";

/** Durable host context owns all identities; generated code can only choose a declared binding/input. */
export async function executeHostedConnections(
  host,
  { publication, action, digest, snapshot, invocation, namespace, signal },
) {
  const agreement = publication.artifact.agreement;
  const live = namespace === "live";
  const releaseId = publication.identity.resourceId;
  let attempt = null;
  if (live && agreement.connections?.length) {
    host.accounts.requireApproval(releaseId, agreement.connections);
    attempt = host.accounts.begin(namespace, {
      action,
      digest,
      releaseId,
      version: snapshot.version,
      invocation,
    });
    invocation = attempt.invocation;
  }
  let handled = 0;
  const reply = await executeConnectedOperation({
    agreement,
    invocation,
    signal,
    execute: (input, current) =>
      host.executePackage(
        publication.artifact.package,
        input,
        live ? "live" : "test",
        current,
      ),
    invoke:
      live && agreement.connections?.length
        ? async (request, index, current) => {
            current.throwIfAborted();
            host.accounts.requireApproval(releaseId, agreement.connections);
            const service = host.store.service();
            if (
              service.state !== "active" ||
              service.liveReleaseId !== releaseId
            )
              throw serviceCallError(
                "state_changed",
                "The Container stopped or changed before the account action.",
              );
            const binding = agreement.connections.find(
              (item) => item.name === request.connection,
            );
            await accountCommand(host, "service_check", {
              connectionId: binding.connectionId,
              adapter: binding.adapter,
            });
            current.throwIfAborted();
            handled = index + 1;
            const previous = attempt.trace[index];
            if (previous) {
              if (canonicalJson(previous.request) !== canonicalJson(request))
                throw serviceCallError(
                  "action_conflict",
                  "Generated code changed an already saved outside request.",
                );
              if (previous.status === "completed") return previous.result;
            }
            if (!previous) {
              if (binding.adapter.method === "POST")
                attempt.writeStarted = true;
              attempt.trace.push({
                request,
                result: null,
                status: "pending",
              });
              host.accounts.save(namespace, attempt);
            }
            const response = await accountCommand(host, "service_invoke", {
              serviceId: publication.identity.serviceId,
              actionId: action.actionId,
              index,
              connectionId: binding.connectionId,
              adapter: binding.adapter,
              input: request.input,
            });
            const existing = host.accounts.pending(namespace);
            if (!existing || existing.action.actionId !== action.actionId)
              throw serviceCallError(
                "state_changed",
                "The Container removed this pending action.",
              );
            attempt.trace[index] = {
              request,
              result: response.result,
              status: "completed",
            };
            host.accounts.save(namespace, attempt);
            current.throwIfAborted();
            return response.result;
          }
        : null,
  });
  if (
    attempt &&
    (handled !== attempt.trace.length ||
      attempt.trace.some((item) => item.status !== "completed"))
  )
    throw serviceCallError(
      "needs_checking",
      "Generated code skipped a saved outside request. Its result still needs checking.",
    );
  return reply;
}
