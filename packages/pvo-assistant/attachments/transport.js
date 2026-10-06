import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import { parseServiceSubmissionTarget } from "./submissions.js";

/** Retains HTTP status for the SDK's existing request feedback without exposing response bodies. */
export class ServiceSubmissionHttpError extends Error {
  constructor(status) {
    super("The service request failed.");
    this.status = status;
  }
}

/** Fixed public/test routes only. Credentials are derived from a host-validated target. */
export async function sendServiceSubmission(request, target, fetcher, signal) {
  target = parseServiceSubmissionTarget(target);
  const path =
    target.mode === "try"
      ? `/api/services/${target.serviceId}/releases/${target.releaseId}/try`
      : `/api/services/${target.serviceId}/actions`;
  if (request.url !== `${target.origin}${path}` || request.method !== "POST")
    throw new Error("Invalid service destination.");
  signal?.throwIfAborted();
  const response = await fetcher(request.url, {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": "application/json" },
    credentials: target.mode === "try" ? "same-origin" : "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (
    !response.ok ||
    response.headers.get("Content-Type")?.split(";", 1)[0].trim() !==
      "application/json"
  ) {
    await response.body?.cancel();
    if (!response.ok) throw new ServiceSubmissionHttpError(response.status);
    throw new Error("The service returned an invalid response.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The service returned no response.");
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > SERVICE_PACKAGE_LIMITS.resultBytes + 512)
        throw new Error("The service response is too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
