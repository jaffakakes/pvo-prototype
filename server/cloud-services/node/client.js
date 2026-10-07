import { parseNodeBundle } from "../../../packages/pvo-assistant/services/index.js";
import { withAssistantDeadline } from "../../assistant/deadline.js";
import { NODE_LIMITS as limits } from "./runtime.js";
import { nodeExecutionError } from "./protocol.js";

/** Private two-slot compute admission. Ownership and state authority are supplied by the service/validator. */
export async function executeNodeBundle(
  namespace,
  value,
  invocation,
  scope,
  signal,
) {
  const bundle = parseNodeBundle(value);
  if (typeof namespace?.getByName !== "function")
    throw nodeExecutionError("runtime_unavailable");
  const body = JSON.stringify(invocation);
  if (
    typeof body !== "string" ||
    new TextEncoder().encode(body).length > limits.invocationBytes
  )
    throw nodeExecutionError("input_limit");
  const id = crypto.randomUUID(),
    expiresAt = Date.now() + limits.leaseMs;
  const tried = [];
  const cancel = () =>
    Promise.all(
      tried.map((stub) =>
        withAssistantDeadline(() => stub.cancel(id), limits.cleanupMs).catch(
          () => null,
        ),
      ),
    );
  let finished = false;
  try {
    return await withAssistantDeadline(
      async (current) => {
        const first = parseInt(id.slice(0, 2), 16) % limits.slots;
        for (let offset = 0; offset < limits.slots; offset++) {
          current.throwIfAborted();
          const stub = namespace.getByName(
            `slot-${(first + offset) % limits.slots}`,
          );
          tried.push(stub);
          // Tombstones handle cancellation that reaches the slot before this dispatch.
          const response = await stub.execute({
            id,
            ownerId: scope.ownerId,
            serviceId: scope.serviceId,
            mode: scope.mode,
            expiresAt,
            bundle,
            invocation,
          });
          current.throwIfAborted();
          if (response?.ok === true) {
            finished = true;
            return response.value;
          }
          if (
            response?.code === "execution_capacity" ||
            response?.code === "execution_allowance"
          ) {
            if (offset < limits.slots - 1) continue;
          }
          const error = nodeExecutionError(
            response?.code ?? "execution_failed",
          );
          if (response?.code === "timeout") error.status = 504;
          if (Number.isSafeInteger(response?.retryAt))
            error.retryAt = response.retryAt;
          throw error;
        }
      },
      limits.leaseMs + limits.cleanupMs,
      signal,
    );
  } finally {
    // Unknown dispatch/abort is never rerun here. Each contacted slot retains its own cleanup lease.
    if (!finished) await cancel();
  }
}
