import { isPvoLanguageActionAllowed } from "../../packages/pvo-language/index.js";
import { formValuesForComponent } from "./form-values.js";

/** Validate viewer commands and execute their compiled or manifest-authored actions. */
export function createComponentActions({ session, adapters }) {
  function answerComponent(detail) {
    const component = session.manifest?.components?.find((item) => item.id === detail.componentId);
    if (!component) return;
    const index = component.kind === "choice"
      ? (Number.isInteger(detail.index) ? detail.index : detail.answer ? 0 : 1)
      : 0;
    if (component.kind === "choice" && (index < 0 || index >= component.options.length)) return;
    return runComponentActions(component, index);
  }

  function answerFieldComponent(detail) {
    if (!session.captureMode) return;
    const component = session.manifest?.components?.find((item) => item.id === detail.componentId);
    if (!component) return;
    return runComponentActions(component, detail.index, detail.fields);
  }

  function submitFormComponent(detail) {
    if (session.captureMode) return;
    const component = session.manifest?.components?.find((item) => item.id === detail.componentId);
    if (component?.kind === "form") return runComponentActions(component, 0, detail.fields);
  }

  function componentAction(component, index) {
    if (component.kind === "choice") return component.options?.[index]?.actions || component.options?.[index]?.action;
    if (component.kind === "card") return component.actions?.[index]?.actions || component.actions?.[index]?.action;
    if (component.kind === "form") return component.on_submit;
    return null;
  }

  async function runComponentActions(component, index, fields) {
    if (session.pendingComponents.has(component.id)) return;
    session.pendingComponents.add(component.id);
    adapters.setComponentPending?.(component.id, true);
    const interaction = { outcome: null, requestFailed: false };
    const previousChoices = session.actionRuntime?.state?.choices || {};
    const previousChoice = Object.hasOwn(previousChoices, component.id) ? previousChoices[component.id] : undefined;
    const previousAnswers = session.actionRuntime?.state?.answers || {};
    const previousAnswer = Object.hasOwn(previousAnswers, component.id) ? previousAnswers[component.id] : undefined;
    let unsubscribe = null;
    try {
      if (fields != null) {
        fields = formValuesForComponent(component, fields, session.pvoLanguageSources.get(component.id)?.structure);
        // Component IDs are opaque strings. Replace the top-level map rather than
        // treating the ID as a dotted state path (which could contain '.', etc.).
        session.actionRuntime?.setState("form", { ...(session.actionRuntime.state.form || {}), [component.id]: fields });
      }
      const form = component.restyle_capture?.form;
      if (component.kind === "form" && form && form.submitMode !== "local" && !form.destination && !form.failureOutcome) {
        adapters.setStatus("This form is not set up to send yet.", true);
        return;
      }
      if (component.kind === "choice") {
        // Preserve all 2–4 option indices. `answers` remains the separate binary
        // value consumed by the optional true/false scene_change route.
        session.actionRuntime?.setState("choices", { ...(session.actionRuntime.state.choices || {}), [component.id]: index });
        if (component.options?.length === 2 || component.scene_change?.enabled) {
          session.actionRuntime?.setState("answers", { ...(session.actionRuntime.state.answers || {}), [component.id]: index === 0 });
        }
      }
      unsubscribe = session.actionRuntime?.subscribe((event) => {
        if (event.type === "request_error") interaction.requestFailed = true;
      });
      const action = componentAction(component, index);
      const result = await session.actionRuntime?.execute(action, {
        componentId: component.id, optionIndex: index, form: fields, playerInteraction: interaction,
      });
      if (interaction.requestFailed && !interaction.outcome) {
        if (component.kind === "choice") {
          session.actionRuntime?.setState("choices", { ...(session.actionRuntime.state.choices || {}), [component.id]: previousChoice });
          if (component.options?.length === 2 || component.scene_change?.enabled) {
            session.actionRuntime?.setState("answers", { ...(session.actionRuntime.state.answers || {}), [component.id]: previousAnswer });
          }
        }
        return;
      }
      let answer = index === 0;
      if (component.kind === "form") answer = typeof result === "boolean" ? result : true;
      session.answers.set(component.id, answer);
      if (component.kind === "form") session.actionRuntime?.setState("answers", {
        ...(session.actionRuntime.state.answers || {}), [component.id]: answer,
      });
      const fallback = session.captureMode ? adapters.captureOutcome(component, index) : { kind: "continue" };
      await adapters.applyActionOutcome(component, index, interaction.outcome || fallback);
    } catch (error) {
      adapters.setStatus(String(error?.message || error), true);
    } finally {
      unsubscribe?.();
      session.pendingComponents.delete(component.id);
      adapters.setComponentPending?.(component.id, false);
    }
  }

  async function handleCustomAction(component, action) {
    // The renderer reports only the control used; compiled PVO Logic owns its outcome.
    if (!session.captureMode || session.finished || !session.mountedCustom.has(component.id)
        || !adapters.visibleComponents().some((item) => item.id === component.id)) return;
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
        await runComponentActions(component, index);
      } else if (method === "submit") {
        await runComponentActions(component, 0, args[0]);
      } else {
        throw new Error("That player action is not supported.");
      }
    } catch (error) {
      adapters.setStatus(`PVO · ${String(error?.message || error)}`, true);
    }
  }

  return { handleCustomAction, answerComponent, answerFieldComponent, submitFormComponent };
}
