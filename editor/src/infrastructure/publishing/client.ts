import type { CompletedExport, PublicationInput } from "../../domain/publishing/model";
import { publicationList, publicationReservation, publishingStatus, unavailablePublishing } from "../../domain/publishing/responses";

type Options = { origin?: string; fetch?: typeof fetch; timeoutMs?: number };

export class PublishingHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PublishingHttpError";
  }
}

function responseFailure(status: number) {
  if (status === 401) return new PublishingHttpError(status, "Your sharing session expired. Try creating the link again.");
  if (status === 410) return new PublishingHttpError(status, "This link is no longer available. Try creating it again.");
  if (status === 413) return new PublishingHttpError(status, "This file exceeds the online size limit.");
  if (status === 429) return new PublishingHttpError(status, "Sharing is busy. Try again shortly.");
  if (status === 404 || status === 503) return new PublishingHttpError(status, "Link sharing isn’t available yet.");
  return new PublishingHttpError(status, "Link sharing failed. Try again.");
}

/** Same-origin browser-owned publications; static deployments keep local files available. */
export function createPublishingClient(options: Options = {}) {
  const origin = options.origin ?? location.origin;
  const send = options.fetch ?? fetch;
  const json = async (path: string, init: RequestInit, signal?: AbortSignal, statusRequest = false) => {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => { controller.abort(signal?.reason); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        const error = new Error("Sharing timed out. Try again.");
        controller.abort(error); reject(error);
      }, options.timeoutMs ?? (init.method === "PUT" ? 180000 : 30000));
    });
    try {
      return await Promise.race([stopped, (async () => {
        const response = await send(new URL(path, origin).href, { ...init, credentials: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal });
        if (statusRequest && ([404, 501, 503].includes(response.status) || !response.headers.get("Content-Type")?.includes("application/json"))) return unavailablePublishing;
        if (!response.ok) throw responseFailure(response.status);
        if (response.status === 204) return null;
        return response.json();
      })()]);
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    async status(signal?: AbortSignal) {
      return publishingStatus(await json("/api/publishing", { method: "GET" }, signal, true));
    },
    async session(signal?: AbortSignal) {
      return publishingStatus(await json("/api/publishing/session", { method: "POST" }, signal));
    },
    async reserve(input: PublicationInput, signal?: AbortSignal) {
      return publicationReservation(await json("/api/publications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal), origin);
    },
    async upload(id: string, artifact: CompletedExport, signal?: AbortSignal) {
      const result = publicationReservation(await json(`/api/publications/${encodeURIComponent(id)}/content`, {
        method: "PUT", headers: { "Content-Type": artifact.contentType }, body: artifact.blob,
      }, signal), origin);
      if (result.id !== id) throw new Error("The upload returned a different publication.");
      return result;
    },
    async list(signal?: AbortSignal) {
      return publicationList(await json("/api/publications", { method: "GET" }, signal), origin);
    },
    async remove(id: string, signal?: AbortSignal) {
      await json(`/api/publications/${encodeURIComponent(id)}`, { method: "DELETE" }, signal);
    },
  };
}
export type PublishingClient = ReturnType<typeof createPublishingClient>;
