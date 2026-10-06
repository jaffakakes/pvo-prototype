import {
  createServiceSubmissionClient,
  openServiceSubmissionStore,
  matchesPublicServiceRequest,
  sendServiceSubmission,
  ServiceSubmissionHttpError,
  retryServiceSubmission,
  recoverServiceSubmissionFields,
} from "../../packages/pvo-assistant/attachments/index.js";
import { preparePlayerServiceSubmission } from "./connections.js";

/** Only host-created interactions receive a transport. Renderer data cannot manufacture it. */
export function createPlayerServiceRequests({
  openStore = openServiceSubmissionStore,
  createId = () => crypto.randomUUID(),
  request = (...args) => fetch(...args),
} = {}) {
  const requests = new WeakMap();
  return {
    async readRecovery(entry) {
      const store = await openStore();
      try {
        const value = await store.read(entry.slot);
        if (!value) return null;
        const saved = retryServiceSubmission(value, entry.target);
        return {
          actionId: saved.action.actionId,
          complete: saved.response !== null,
          fields: recoverServiceSubmissionFields(
            saved,
            entry.target,
            entry.connection.input,
          ),
        };
      } finally {
        store.close();
      }
    },
    prepare(
      interaction,
      entry,
      component,
      language,
      index,
      fields,
      isCurrent,
      retrySaved,
      expectedActionId,
    ) {
      const prepared = preparePlayerServiceSubmission(
        entry,
        component,
        language,
        index,
        fields,
      );
      if (!prepared) return;
      requests.set(interaction, async (wire, signal) => {
        if (!isCurrent())
          throw new DOMException("The interaction changed.", "AbortError");
        if (!matchesPublicServiceRequest(prepared.connection, wire))
          throw new Error(
            "The request no longer matches its service connection.",
          );
        const store = await openStore();
        try {
          const client = createServiceSubmissionClient({
            store,
            createId,
            send: (value, requestSignal) =>
              sendServiceSubmission(
                value,
                prepared.target,
                request,
                requestSignal,
              ),
          });
          const context = { signal, isCurrent };
          const existing =
            retrySaved || expectedActionId
              ? await store.read(prepared.slot)
              : null;
          if (expectedActionId && !existing)
            throw new Error("The saved submission is no longer available.");
          const saved = existing
            ? await client.retry(
                prepared.slot,
                prepared.target,
                context,
                expectedActionId,
              )
            : await client.submit(
                prepared.slot,
                prepared.target,
                prepared.input,
                context,
              );
          // Commit completion before the SDK can publish state or follow its success route.
          return Response.json(saved.response);
        } catch (error) {
          if (!isCurrent())
            throw new DOMException("The interaction changed.", "AbortError");
          if (error instanceof ServiceSubmissionHttpError)
            return new Response(null, { status: error.status });
          throw error;
        } finally {
          store.close();
        }
      });
    },
    forInteraction: (interaction) => requests.get(interaction),
    release: (interaction) => requests.delete(interaction),
  };
}
