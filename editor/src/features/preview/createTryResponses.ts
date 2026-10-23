import { sceneDuration } from "../../domain/scenes/duration";
import {
  acceptsResponse,
  responsePolicyFor,
} from "../../domain/components/responsePolicy";
import {
  formSubmissionOutcome,
  formValuesForSubmission,
  validateFormFields,
} from "../../domain/components/forms";
import { componentEnd } from "../../domain/components/timing";
import { tryInteractionAvailable } from "../../domain/preview/playback";
import type {
  ComponentResponse,
  PlaybackOutcome,
  PvoComponent,
} from "../../domain/project/model";
import type { TrySessionHost, TrySessionState } from "./trySessionHost";
import type { createTryDiagnostics } from "./createTryDiagnostics";
import type { createTryRequests } from "./createTryRequests";
import type { createTryRuntimeBridge } from "./createTryRuntimeBridge";

type Host = Pick<
  TrySessionHost,
  "feedback" | "beginRequest" | "finishRequest"
> & {
  getState(): Pick<
    TrySessionState,
    | "tryMode"
    | "patch"
    | "t"
    | "currentSceneId"
    | "clips"
    | "texts"
    | "components"
    | "layers"
    | "ratio"
  >;
};
type Dependencies = {
  host: Host;
  diagnostics: Pick<
    ReturnType<typeof createTryDiagnostics>,
    "context" | "event" | "response" | "accepted" | "target" | "begin"
  >;
  runtimeBridge: Pick<
    ReturnType<typeof createTryRuntimeBridge>,
    "current" | "isCurrent"
  >;
  requests: Pick<
    ReturnType<typeof createTryRequests>,
    "execute" | "pendingCount"
  >;
  getEpoch(): number;
  stopTry(): void;
  runPlaybackOutcome(
    component: PvoComponent,
    outcome: PlaybackOutcome,
    interactionId?: string,
  ): boolean;
};

/** Captures input once and dispatches it only at its declared response boundary. */
export function createTryResponses({
  host,
  diagnostics,
  runtimeBridge,
  requests,
  getEpoch,
  stopTry,
  runPlaybackOutcome,
}: Dependencies) {
  function writeResponseState(
    component: PvoComponent,
    response: ComponentResponse,
  ) {
    const runtime = runtimeBridge.current();
    if (!runtime) return;
    if (component.type === "form" && response.formValues) {
      runtime.setState(
        "form",
        {
          ...(runtime.state.form as Record<string, unknown> | undefined),
          [component.id]: response.formValues,
        },
        {
          componentId: component.id,
          diagnostic: diagnostics.context(component, response),
        },
      );
    }
    if (component.type === "choice") {
      runtime.setState(
        "choices",
        {
          ...(runtime.state.choices as Record<string, unknown> | undefined),
          [component.id]: response.index,
        },
        {
          componentId: component.id,
          diagnostic: diagnostics.context(component, response),
        },
      );
    }
  }

  /** Execute a captured response with the same SDK request policy as an exported PVO. */
  async function executeResponse(
    component: PvoComponent,
    response: ComponentResponse,
  ): Promise<boolean> {
    const state = host.getState();
    const outcome = response.outcome;
    const diagnosticContext = diagnostics.context(component, response);
    if (!state.tryMode) return false;
    if (
      outcome.kind === "request" &&
      host.feedback()[component.id]?.phase === "pending"
    ) {
      diagnostics.event(
        component,
        "interaction.ignored",
        "request_pending",
        diagnosticContext.interactionId,
      );
      return false;
    }
    writeResponseState(component, response);
    if (
      component.type === "form" &&
      component.fields.formFields &&
      formSubmissionOutcome(component) === null
    ) {
      if (component.fields.failureOutcome)
        return runPlaybackOutcome(
          component,
          component.fields.failureOutcome,
          diagnosticContext.interactionId,
        );
      const operation = host.beginRequest(component.id);
      host.finishRequest(component.id, operation, true);
      diagnostics.event(
        component,
        "action.failed",
        "missing_destination",
        diagnosticContext.interactionId,
      );
      return false;
    }
    if (outcome.kind !== "request") {
      return runPlaybackOutcome(
        component,
        outcome,
        diagnosticContext.interactionId,
      );
    }
    return requests.execute(component, response, diagnosticContext);
  }

  async function dispatchCapturedResponse(
    component: PvoComponent,
  ): Promise<void> {
    const state = host.getState();
    const mode = state.tryMode;
    const response = mode?.capturedResponses[component.id];
    if (!mode || !response || mode.dispatched.includes(component.id)) return;
    diagnostics.event(
      component,
      "action.selected",
      undefined,
      diagnostics.context(component, response).interactionId,
    );
    const epoch = getEpoch();
    const runtime = runtimeBridge.current();
    state.patch({
      tryMode: { ...mode, dispatched: [...mode.dispatched, component.id] },
    });
    const succeeded = await executeResponse(component, response);
    const latest = host.getState();
    const latestMode = latest.tryMode;
    const terminalSettled =
      epoch === getEpoch() &&
      runtimeBridge.isCurrent(runtime) &&
      latestMode &&
      latest.currentSceneId === component.sceneId &&
      latestMode.holdingId === null &&
      latest.t >= sceneDuration(latest) - 0.001 &&
      requests.pendingCount === 0;
    if (terminalSettled) {
      stopTry();
      return;
    }
    if (
      succeeded ||
      epoch !== getEpoch() ||
      !runtimeBridge.isCurrent(runtime) ||
      !latestMode ||
      latest.currentSceneId !== component.sceneId ||
      latestMode.capturedResponses[component.id] !== response
    )
      return;
    if (
      latestMode.holdingId === component.id &&
      !tryInteractionAvailable(latest, component, latest.t)
    ) {
      // Keep the failed-request feedback, but never require a retry on an invisible control.
      latest.patch({
        playing: true,
        tryMode: { ...latestMode, playing: true, holdingId: null },
      });
      return;
    }
    latest.patch({
      tryMode: {
        ...latestMode,
        dispatched: latestMode.dispatched.filter((id) => id !== component.id),
      },
    });
  }

  /** Capture locally first; the policy decides when the response reaches Logic. */
  async function runComponentResponse(
    component: PvoComponent,
    response: ComponentResponse,
    interactionId?: string,
  ): Promise<void> {
    const state = host.getState();
    const mode = state.tryMode;
    const input = diagnostics.response(component, response, interactionId);
    if (
      !mode ||
      !acceptsResponse(component) ||
      !tryInteractionAvailable(state, component, state.t)
    ) {
      diagnostics.event(
        component,
        "interaction.ignored",
        "inactive_component",
        input,
      );
      return;
    }
    const policy = responsePolicyFor(component);
    const atBoundary = mode.holdingId === component.id;
    if (mode.dispatched.includes(component.id)) {
      diagnostics.event(
        component,
        "interaction.ignored",
        host.feedback()[component.id]?.phase === "pending"
          ? "request_pending"
          : "already_dispatched",
        input,
      );
      return;
    }
    if (!atBoundary && mode.handled.includes(component.id)) {
      diagnostics.event(
        component,
        "interaction.ignored",
        "already_handled",
        input,
      );
      return;
    }
    diagnostics.accepted(component.id, input);
    const previous = mode.capturedResponses[component.id];
    if (
      previous &&
      policy.dispatch === "layer_end" &&
      !atBoundary &&
      !mode.handled.includes(component.id)
    )
      diagnostics.event(
        component,
        "action.cancelled",
        "superseded",
        diagnostics.context(component, previous).interactionId,
      );
    diagnostics.event(component, "interaction.accepted", undefined, input, {
      target: diagnostics.target(component, response.index),
    });
    const capturedResponses = {
      ...mode.capturedResponses,
      [component.id]: response,
    };
    const handled =
      atBoundary && !mode.handled.includes(component.id)
        ? [...mode.handled, component.id]
        : mode.handled;
    state.patch({ tryMode: { ...mode, capturedResponses, handled } });
    if (policy.dispatch === "interaction" || atBoundary)
      await dispatchCapturedResponse(component);
    else
      diagnostics.event(component, "response.deferred", "layer_end", input, {
        waitUntil: componentEnd(component, state.clips),
      });
  }

  /** Form values stay in session state; only an explicit request sends them to a destination. */
  async function runFormSubmission(
    component: PvoComponent,
    values: Record<string, string>,
  ): Promise<void> {
    if (
      !host.getState().tryMode ||
      host.feedback()[component.id]?.phase === "pending"
    ) {
      const input = diagnostics.begin(component, 0);
      diagnostics.event(
        component,
        "interaction.ignored",
        host.getState().tryMode ? "request_pending" : "inactive_component",
        input,
      );
      return;
    }
    try {
      if (component.fields.formFields)
        validateFormFields(component.fields.formFields);
      const outcome = formSubmissionOutcome(component) ??
        component.fields.failureOutcome ?? { kind: "continue" };
      const formValues = formValuesForSubmission(component.fields, values);
      await runComponentResponse(component, { index: 0, outcome, formValues });
    } catch (error) {
      console.warn("Could not submit form in Try mode:", error);
      const operation = host.beginRequest(component.id);
      host.finishRequest(component.id, operation, true);
      diagnostics.event(component, "action.failed", "invalid_form");
    }
  }
  return { dispatchCapturedResponse, runComponentResponse, runFormSubmission };
}
