import { isPvoLanguageActionAllowed } from "../../packages/pvo-language/index.js";
import { formValuesForComponent } from "./form-values.js";
import {
  actionOperationIsCurrent,
  beginActionOperation,
  finishActionOperation,
} from "./operations.js";
import { responsePolicyFor } from "./response-policy.js";
import { clearComponentRequestFailure, markComponentRequestFailure } from "./request-status.js";
import { beginPlayerDiagnostic, reportPlayerDiagnostic } from "./diagnostics.js";

/** Validate viewer commands, capture responses, and dispatch authored actions. */
export function createComponentActions({ session, adapters }) {
  function componentFor(detail) {
    return session.manifest?.components?.find((item) => item.id === detail.componentId);
  }

  function answerComponent(detail) {
    const component = componentFor(detail);
    if (!component) return;
    const indexed = component.kind === "choice" || component.kind === "card";
    const index = indexed ? detail.index : 0;
    const count = component.kind === "choice"
      ? component.options?.length || 0
      : component.kind === "card" ? component.actions?.length || 0 : 1;
    if (indexed && (index < 0 || index >= count)) return;
    return captureComponentResponse(component, index);
  }

  function answerFieldComponent(detail) {
    if (!session.captureMode) return;
    const component = componentFor(detail);
    if (!component) return;
    return captureComponentResponse(component, detail.index, detail.fields);
  }

  function submitFormComponent(detail) {
    if (session.captureMode) return;
    const component = componentFor(detail);
    if (component?.kind === "form") return captureComponentResponse(component, 0, detail.fields);
  }

  function componentAction(component, index) {
    if (component.kind === "choice") return component.options?.[index]?.actions || component.options?.[index]?.action;
    if (component.kind === "card") {
      const control = component.actions?.[index];
      return control?.actions || control?.action;
    }
    if (component.kind === "form") return component.on_submit;
    return null;
  }

  function normalizeFields(component, fields) {
    if (fields == null) return undefined;
    return formValuesForComponent(component, fields, session.pvoLanguageSources.get(component.id)?.structure);
  }

  /**
   * A layer-end response is local viewer state until its boundary. Replacing it
   * before then deliberately implements "latest response wins" without calling Logic.
   */
  function captureComponentResponse(component, index, fields) {
    const diagnostic = beginPlayerDiagnostic(session, component, component.kind === "form" ? "submit" : index);
    const ignored = reason => reportPlayerDiagnostic(session, "interaction.ignored", diagnostic, { reason });
    if (session.pendingComponents.has(component.id)) {
      ignored("request_pending");
      return;
    }
    const policy = responsePolicyFor(component);
    const previous = session.capturedResponses.get(component.id);
    if (policy.dispatch === "interaction" && previous?.status === "complete") {
      ignored("already_handled");
      return;
    }
    if (session.handledResponses.has(component.id) && session.awaitingComponent?.id !== component.id) {
      ignored("already_handled");
      return;
    }
    let normalizedFields;
    try {
      normalizedFields = normalizeFields(component, fields);
    } catch (error) {
      ignored("invalid_fields");
      adapters.setStatus(String(error?.message || error), true);
      return;
    }

    const response = {
      componentId: component.id,
      index,
      fields: normalizedFields,
      status: "captured",
      ...(diagnostic ? { diagnostic } : {}),
    };
    session.capturedResponses.set(component.id, response);
    adapters.updateComponentResponse?.(component.id);
    reportPlayerDiagnostic(session, "interaction.accepted", diagnostic);

    if (policy.dispatch === "layer_end" && session.awaitingComponent?.id !== component.id) {
      reportPlayerDiagnostic(session, "response.deferred", diagnostic, {
        reason: "layer_end", waitUntil: component.presentation?.end,
      });
      return;
    }
    return dispatchCapturedResponse(component.id);
  }

  /** Dispatch a previously captured response; used by both taps and layer boundaries. */
  async function dispatchCapturedResponse(componentId) {
    const response = session.capturedResponses.get(componentId);
    const component = session.manifest?.components?.find((item) => item.id === componentId);
    if (!response || !component || response.status === "pending" || response.status === "complete") return;
    return runComponentActions(component, response.index, response.fields, response);
  }

  async function runComponentActions(component, index, fields, capturedResponse) {
    if (session.pendingComponents.has(component.id) || !session.actionRuntime) return;
    const runtime = session.actionRuntime;
    const diagnostic = capturedResponse?.diagnostic;
    clearComponentRequestFailure(session, component.id, adapters.setStatus);
    const operation = beginActionOperation(session, component.id);
    const interaction = {
      outcome: null,
      unhandledRequestFailed: false,
      operation,
    };
    if (capturedResponse) capturedResponse.status = "pending";
    adapters.setComponentPending?.(component.id, true);

    let unsubscribe = null;
    try {
      // Runtime state changes at dispatch, never while a layer-end response is merely captured.
      if (fields != null) {
        runtime.setState("form", { ...(runtime.state.form || {}), [component.id]: fields }, { componentId: component.id, diagnostic });
      }
      const form = component.restyle_capture?.form;
      if (component.kind === "form" && form && form.submitMode !== "local" && !form.destination && !form.failureOutcome) {
        adapters.setStatus("This form is not set up to send yet.", true);
        if (capturedResponse) capturedResponse.status = "failed";
        return;
      }
      if (component.kind === "choice") {
        // Preserve the selected 2–4 option index; routing remains an explicit action.
        runtime.setState("choices", { ...(runtime.state.choices || {}), [component.id]: index }, { componentId: component.id, diagnostic });
      }
      unsubscribe = runtime.subscribe((event) => {
        if (event.type === "request_error" && event.componentId === component.id) {
          interaction.unhandledRequestFailed ||= event.handled !== true;
        }
      });
      const action = componentAction(component, index);
      if (!action) reportPlayerDiagnostic(session, "action.skipped", diagnostic, { reason: "no_matching_rule" });
      await runtime.execute(action, {
        componentId: component.id,
        optionIndex: index,
        form: fields,
        playerInteraction: interaction,
        signal: operation.controller.signal,
        diagnostic,
      });
      if (!actionOperationIsCurrent(session, operation)) return;

      if (interaction.unhandledRequestFailed && !interaction.outcome) {
        if (capturedResponse) capturedResponse.status = "failed";
        markComponentRequestFailure(session, component.id, adapters.setStatus);
        return;
      }

      if (capturedResponse) capturedResponse.status = "complete";
      const fallback = session.captureMode ? adapters.captureOutcome(component, index) : { kind: "continue" };
      await adapters.applyActionOutcome(component, index, interaction.outcome || fallback);
    } catch (error) {
      if (!actionOperationIsCurrent(session, operation)) return;
      if (capturedResponse) capturedResponse.status = "failed";
      reportPlayerDiagnostic(session, "action.failed", diagnostic, { reason: "action_error" });
      adapters.setStatus(String(error?.message || error), true);
    } finally {
      unsubscribe?.();
      if (finishActionOperation(session, operation)) {
        adapters.setComponentPending?.(component.id, false);
        adapters.updateComponentResponse?.(component.id);
      }
    }
  }

  async function handleCustomAction(component, action) {
    // The renderer reports only the control used; compiled PVO Logic owns its outcome.
    if (!session.captureMode || session.finished || !session.mountedCustom.has(component.id)
        || !adapters.visibleComponents().some((item) => item.id === component.id)) {
      const diagnostic = beginPlayerDiagnostic(session, component, action?.method || "unknown");
      reportPlayerDiagnostic(session, "interaction.ignored", diagnostic, { reason: "inactive_component" });
      return;
    }
    try {
      const method = action?.method;
      const args = Array.isArray(action?.args) ? action.args : [];
      if (!isPvoLanguageActionAllowed(component.kind, method)) {
        throw new Error(`PVO ${component.kind} cannot use that action.`);
      }
      if (method === "pick") {
        const index = args[0];
        const count = component.kind === "choice" ? Math.min(4, component.options?.length || 0)
          : component.kind === "card" ? Math.min(2, component.restyle_capture?.buttons?.length || 0) : 0;
        if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("That option is not available.");
        await captureComponentResponse(component, index);
      } else if (method === "submit") {
        await captureComponentResponse(component, 0, args[0]);
      } else {
        throw new Error("That player action is not supported.");
      }
    } catch (error) {
      adapters.setStatus(`PVO · ${String(error?.message || error)}`, true);
    }
  }

  return {
    handleCustomAction,
    answerComponent,
    answerFieldComponent,
    submitFormComponent,
    dispatchCapturedResponse,
  };
}
