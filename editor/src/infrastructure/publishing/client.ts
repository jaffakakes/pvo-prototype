import type { CompletedExport, PublicationInput } from "../../domain/publishing/model";
import { publicationList, publicationReservation, publishingStatus, unavailablePublishing } from "../../domain/publishing/responses";

type Options = { origin?: string; fetch?: typeof fetch; timeoutMs?: number };
const MULTIPART_THRESHOLD = 50 * 1024 * 1024;

export class PublishingHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PublishingHttpError";
  }
}

function responseFailure(status: number) {
  if (status === 401) return new PublishingHttpError(status, "Sign in to manage or create links.");
  if (status === 410) return new PublishingHttpError(status, "This link is no longer available. Try creating it again.");
  if (status === 413) return new PublishingHttpError(status, "This file exceeds the online size limit.");
  if (status === 429) return new PublishingHttpError(status, "Sharing is busy. Try again shortly.");
  if (status === 404 || status === 503) return new PublishingHttpError(status, "Link sharing isn’t available yet.");
  return new PublishingHttpError(status, "Link sharing failed. Try again.");
}

/** Same-origin account-owned publications. */
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
      }, options.timeoutMs ?? (path.includes("/multipart/") && init.method === "PUT" ? 30 * 60 * 1000
        : init.method === "PUT" ? 180000 : 30000));
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
    async reserve(input: PublicationInput, signal?: AbortSignal) {
      return publicationReservation(await json("/api/publications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal), origin);
    },
    async upload(id: string, artifact: CompletedExport, signal?: AbortSignal, onProgress?: (uploadedBytes: number) => void) {
      const path = `/api/publications/${encodeURIComponent(id)}`;
      let response: unknown;
      if (artifact.blob.size <= MULTIPART_THRESHOLD) {
        response = await json(`${path}/content`, {
          method: "PUT", headers: { "Content-Type": artifact.contentType }, body: artifact.blob,
        }, signal);
        onProgress?.(artifact.blob.size);
      } else {
        const started = await json(`${path}/multipart`, { method: "POST" }, signal);
        if (started?.status === "ready") response = started;
        else {
          const size = started?.chunkBytes;
          if (!Number.isSafeInteger(size) || size < 8 * 1024 * 1024 || size > 64 * 1024 * 1024
            || Math.ceil(artifact.blob.size / size) > 10000)
            throw new Error("The server returned an invalid upload size.");
          const parts: { partNumber: number; etag: string }[] = [];
          for (let offset = 0, partNumber = 1; offset < artifact.blob.size; offset += size, partNumber++) {
            signal?.throwIfAborted();
            const uploaded = await json(`${path}/multipart/${partNumber}`, {
              method: "PUT", headers: { "Content-Type": "application/octet-stream" },
              body: artifact.blob.slice(offset, offset + size),
            }, signal);
            if (uploaded?.partNumber !== partNumber || typeof uploaded?.etag !== "string" || !uploaded.etag)
              throw new Error("The server did not confirm an upload part. Please retry.");
            parts.push({ partNumber, etag: uploaded.etag });
            onProgress?.(Math.min(artifact.blob.size, offset + size));
          }
          response = await json(`${path}/multipart/complete`, { method: "PUT",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts }) }, signal);
        }
      }
      const result = publicationReservation(response, origin);
      if (result.id !== id) throw new Error("The upload returned a different publication.");
      return result;
    },
    async uploadPoster(id: string, poster: Blob, signal?: AbortSignal) {
      if (!["image/webp", "image/png"].includes(poster.type) || !poster.size || poster.size > 5 * 1024 * 1024)
        throw new Error("The selected cover could not be shared. Choose another frame and export again.");
      await json(`/api/publications/${encodeURIComponent(id)}/poster`, {
        method: "PUT", headers: { "Content-Type": poster.type }, body: poster,
      }, signal);
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
