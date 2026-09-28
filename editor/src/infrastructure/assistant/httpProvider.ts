import type { AssistantRequest } from "../../domain/assistant/model";
import { AssistantServiceError } from "../../domain/assistant/failure";

/** Endpoint selection is explicit; this adapter never discovers or starts a provider. */
export function createHttpProvider(endpoint: string, send: typeof fetch = fetch, timeoutMs = 60000) {
  const base = typeof location === "undefined" ? "http://localhost/" : location.href;
  const url = new URL(endpoint, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("The assistant endpoint must be an HTTP(S) URL without embedded credentials.");

  return async (request: AssistantRequest, signal?: AbortSignal): Promise<unknown> => {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort(signal?.reason);
        reject(signal?.reason ?? new DOMException("Assistant request cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        const error = new AssistantServiceError(504, "The assistant request timed out.");
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([stopped, (async () => {
        const response = await send(url.href, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(request),
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new AssistantServiceError(response.status);
        try { return await response.json(); }
        catch (error) {
          signal?.throwIfAborted();
          throw new Error("The connected assistant did not return a JSON proposal.", { cause: error });
        }
      })()]);
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener("abort", cancel);
    }
  };
}
