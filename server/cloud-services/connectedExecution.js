import {
  parseServiceInvocation,
  parseAccountRequest,
  exampleAccountResult,
  SERVICE_EXECUTION_LIMITS,
} from "../../packages/pvo-assistant/services/index.js";
import { ADAPTER_LIMITS } from "../../packages/pvo-assistant/connections/index.js";
import { object } from "../../packages/pvo-assistant/tasks/validation.js";
import { withAssistantDeadline } from "../assistant/deadline.js";

/** Restartable isolated executions exchange checked JSON; the guest never gets a network bridge or credential. */
export function executeConnectedOperation({
  agreement,
  invocation,
  execute,
  invoke = null,
  signal,
}) {
  return withAssistantDeadline(
    async (current) => {
      const results = [];
      for (let index = 0; index <= ADAPTER_LIMITS.calls; index++) {
        current.throwIfAborted();
        const input = parseServiceInvocation(agreement, {
          ...invocation,
          ...(results.length ? { connectionResults: results } : {}),
        });
        const reply = await execute(input, current);
        current.throwIfAborted();
        if (!reply || !Object.hasOwn(reply, "request")) return reply;
        object(reply, ["request"], "Account request reply");
        if (index === ADAPTER_LIMITS.calls)
          throw new Error(
            "This operation exceeded its agreed account-call capacity.",
          );
        const request = parseAccountRequest(
          agreement,
          invocation.operation,
          reply.request,
        );
        const result = invoke
          ? await invoke(request, index, current)
          : exampleAccountResult(agreement, invocation.operation, request);
        current.throwIfAborted();
        results.push({ ...request, result });
        // Validate externally returned data before sending any of it into a new guest.
        parseServiceInvocation(agreement, {
          ...invocation,
          connectionResults: results,
        });
      }
      throw new Error("No completed service reply.");
    },
    SERVICE_EXECUTION_LIMITS.requestMs - 10000,
    signal,
  );
}
