import {
  createServiceSubmissionClient,
  ServiceSubmissionHttpError,
  sendServiceSubmission,
  matchesComponentServiceRequest,
  type ServiceSubmissionStore,
} from "../../../../packages/pvo-assistant/attachments/index.js";
import {
  prepareComponentTest,
  type ComponentTestScope,
} from "../../domain/components/serviceSubmission";
import type {
  ComponentResponse,
  PvoComponent,
} from "../../domain/project/model";

export type TryServiceRequest = (
  request: { url: string; method: string; body?: string },
  signal?: AbortSignal,
) => Promise<Response>;
export type TryServiceHost = {
  scope(): ComponentTestScope;
  openStore(): Promise<ServiceSubmissionStore & { close(): void }>;
  createId(): string;
  request: typeof fetch;
};

/** Prepare synchronously; open owned storage only for the SDK's bounded, current request. */
export function createTryServiceRequests(host: TryServiceHost) {
  return function prepare(
    component: PvoComponent,
    response: ComponentResponse,
    isCurrent: () => boolean,
    retrySaved: boolean,
  ): TryServiceRequest | null {
    if (!component.serviceConnection) return null;
    const scope = host.scope();
    const prepared = prepareComponentTest(component, response, scope);
    if (!prepared) return null;
    return async (request, signal) => {
      if (!isCurrent())
        throw new DOMException(
          "The component interaction changed.",
          "AbortError",
        );
      if (!matchesComponentServiceRequest(prepared.connection, request))
        throw new Error(
          "The component request no longer matches its connection.",
        );
      // Opening can fail after a scope change too; invalidate before the SDK considers an error route.
      const store = await host.openStore().catch((error) => {
        isCurrent();
        throw error;
      });
      try {
        const client = createServiceSubmissionClient({
          store,
          createId: host.createId,
          send: (wire, requestSignal) =>
            sendServiceSubmission(
              wire,
              prepared.target,
              host.request,
              requestSignal,
            ),
        });
        const context = { signal, isCurrent };
        const existing =
          retrySaved || response.recoveryActionId
            ? await store.read(prepared.slot)
            : null;
        // A retry of failed feedback can recover even a response saved after the SDK timed out
        // or before a playback route failed. Starting a new Try is a distinct submission.
        if (response.recoveryActionId && !existing)
          throw new Error("The saved submission is no longer available.");
        const saved = existing
          ? await client.retry(
              prepared.slot,
              prepared.target,
              context,
              response.recoveryActionId,
            )
          : await client.submit(
              prepared.slot,
              prepared.target,
              prepared.input,
              context,
            );
        // The saved result has committed before the SDK can publish state or run success routes.
        return Response.json(saved.response);
      } catch (error) {
        isCurrent();
        if (error instanceof ServiceSubmissionHttpError)
          return new Response(null, { status: error.status });
        throw error;
      } finally {
        store.close();
      }
    };
  };
}
