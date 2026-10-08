import {
  recoverServiceSubmissionFields,
  retryServiceSubmission,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import { prepareComponentTestRecovery } from "../../domain/components/serviceSubmission";
import type {
  ComponentResponse,
  PvoComponent,
} from "../../domain/project/model";
import type { TrySessionHost } from "./trySessionHost";

/** Scope-check saved Try input before and after storage, then use the normal response command. */
export function createTryRecovery(
  host: TrySessionHost,
  epoch: () => number,
  dispatch: (
    component: PvoComponent,
    response: ComponentResponse,
  ) => Promise<void>,
) {
  async function read(component: PvoComponent) {
    if (!host.services || !host.getState().tryMode) return null;
    const { localId, currentSceneId } = host.getState();
    const currentEpoch = epoch();
    const scope = host.services.scope();
    const source = JSON.stringify(component);
    const scopeKey = JSON.stringify(scope);
    const prepared = prepareComponentTestRecovery(component, scope);
    if (!prepared) return null;
    const current = () => {
      const latest = host.getState();
      return (
        epoch() === currentEpoch &&
        !!latest.tryMode &&
        latest.localId === localId &&
        latest.currentSceneId === currentSceneId &&
        JSON.stringify(
          latest.components.find((item) => item.id === component.id),
        ) === source &&
        JSON.stringify(host.services?.scope()) === scopeKey
      );
    };
    const store = await host.services.openStore();
    try {
      if (!current()) return null;
      const value = await store.read(prepared.slot);
      if (!current() || !value) return null;
      const saved = retryServiceSubmission(value, prepared.target);
      const fields = recoverServiceSubmissionFields(
        saved,
        prepared.target,
        prepared.connection.connection.input,
      );
      const formValues: Record<string, string | number | boolean> = {};
      for (const [name, value] of Object.entries(fields)) {
        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        )
          throw new Error("Saved form values are invalid.");
        formValues[name] = value;
      }
      return {
        complete: saved.response !== null,
        response: {
          ...prepared.response,
          formValues,
          recoveryActionId: saved.action.actionId,
        },
        current,
      };
    } finally {
      store.close();
    }
  }
  return {
    async readSavedSubmission(component: PvoComponent) {
      const saved = await read(component);
      return saved ? { complete: saved.complete } : null;
    },
    async recoverSavedSubmission(component: PvoComponent) {
      if (host.feedback()[component.id]?.phase === "pending") return;
      const saved = await read(component);
      if (!saved) throw new Error("There is no saved submission to recover.");
      if (saved.current()) await dispatch(component, saved.response);
    },
  };
}
