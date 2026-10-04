import {
  describeRequestFailure,
  type PvoDiagnosticContext,
} from "../../../../packages/pvo-sdk/index.js";
import { actionFor } from "../../domain/components/actions";
import type {
  ComponentResponse,
  PvoComponent,
} from "../../domain/project/model";
import type { TrySessionHost, TrySessionState } from "./trySessionHost";
import type { createTryDiagnostics } from "./createTryDiagnostics";
import type { createTryRuntimeBridge } from "./createTryRuntimeBridge";

type RequestHost = Pick<TrySessionHost, "beginRequest" | "finishRequest"> & {
  getState(): Pick<
    TrySessionState,
    "tryMode" | "currentSceneId" | "components"
  >;
  diagnostics: Pick<ReturnType<typeof createTryDiagnostics>, "event">;
};
type RequestOutcome = Extract<
  ComponentResponse["outcome"],
  { kind: "request" }
>;

/** Owns pending Try requests, their cancellation and operation-scoped feedback. */
export function createTryRequests(
  host: RequestHost,
  runtime: Pick<
    ReturnType<typeof createTryRuntimeBridge>,
    "current" | "isCurrent"
  >,
) {
  const requestOperations = new Map<
    string,
    {
      controller: AbortController;
      feedbackOperation: number;
    }
  >();
  function cancel(exceptComponentId?: string, reason = "try_stopped") {
    requestOperations.forEach((operation, componentId) => {
      if (componentId !== exceptComponentId) {
        const component = host
          .getState()
          .components.find((item) => item.id === componentId);
        if (component)
          host.diagnostics.event(component, "action.cancelled", reason);
        operation.controller.abort();
        host.finishRequest(componentId, operation.feedbackOperation, false);
      }
    });
    for (const componentId of [...requestOperations.keys()]) {
      if (componentId !== exceptComponentId)
        requestOperations.delete(componentId);
    }
  }

  async function execute(
    component: PvoComponent,
    outcome: RequestOutcome,
    diagnosticContext: PvoDiagnosticContext,
  ) {
    const state = host.getState();
    const activeRuntime = runtime.current();
    if (!activeRuntime) return false;
    const operation = host.beginRequest(component.id);
    const requestOperation = {
      controller: new AbortController(),
      feedbackOperation: operation,
    };
    requestOperations.set(component.id, requestOperation);
    const previewInteraction = { routeFailed: false };
    let actionReady = false;
    let requestErrorSeen = false;
    const unsubscribe = activeRuntime.subscribe((event) => {
      if (event.type === "request_error" && event.componentId === component.id)
        requestErrorSeen = true;
    });
    try {
      const action = actionFor(outcome, component.id);
      actionReady = true;
      await activeRuntime.execute(action, {
        componentId: component.id,
        throwOnRequestError: true,
        signal: requestOperation.controller.signal,
        previewInteraction,
        diagnostic: diagnosticContext,
      });
      if (requestOperations.get(component.id) !== requestOperation)
        return false;
      host.finishRequest(component.id, operation, false);
      return !previewInteraction.routeFailed;
    } catch (error) {
      if (
        requestOperation.controller.signal.aborted ||
        requestOperations.get(component.id) !== requestOperation
      )
        return false;
      // No error route is deliberately a no-op: the component stays available to retry.
      console.warn("PVO request failed in Try mode:", error);
      if (!requestErrorSeen)
        host.diagnostics.event(
          component,
          "action.failed",
          "invalid_action",
          diagnosticContext.interactionId,
        );
      const latest = host.getState();
      if (
        runtime.isCurrent(activeRuntime) &&
        latest.tryMode &&
        latest.currentSceneId === state.currentSceneId
      ) {
        // Authored error routes already communicated the result. An empty-scene
        // route has its own operation key, so completion cannot erase its status.
        host.finishRequest(
          component.id,
          operation,
          !(actionReady && outcome.onError),
          requestErrorSeen ? describeRequestFailure(error) : undefined,
        );
      }
      return !!(
        actionReady &&
        outcome.onError &&
        !previewInteraction.routeFailed
      );
    } finally {
      unsubscribe();
      if (requestOperations.get(component.id) === requestOperation)
        requestOperations.delete(component.id);
    }
  }

  return {
    execute,
    cancel,
    get pendingCount() {
      return requestOperations.size;
    },
    firstPendingId: () => requestOperations.keys().next().value ?? null,
  };
}
