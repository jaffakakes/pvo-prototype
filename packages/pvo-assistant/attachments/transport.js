import { parseReceiptLink } from "./receiptLink.js";
import { platformOrigin } from "./policy.js";
import { SERVICE_PACKAGE_LIMITS } from "../services/index.js";
import {
  parseServiceSubmissionTarget,
  backgroundSubmission,
} from "./submissions.js";

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
  const allowed = backgroundSubmission(target)
    ? ["jobs", "job-receipt"].map(
        (kind) => `${target.origin}/api/services/${target.serviceId}/${kind}`,
      )
    : [`${target.origin}${path}`];
  if (!allowed.includes(request.url) || request.method !== "POST")
    throw new Error("Invalid service destination.");
  return sendWire(
    request,
    target.mode === "try" ? "same-origin" : "omit",
    fetcher,
    signal,
  );
}

export async function readServiceReceipt(origin, reference, fetcher, signal) {
  platformOrigin(origin);
  reference = parseReceiptLink(reference);
  return sendWire(
    {
      url: `${origin}/api/services/${reference.serviceId}/job-receipt`,
      body: JSON.stringify({
        actionId: reference.actionId,
        receiptKey: reference.receiptKey,
      }),
    },
    "omit",
    fetcher,
    signal,
  );
}

async function sendWire(request, credentials, fetcher, signal) {
  signal?.throwIfAborted();
  const response = await fetcher(request.url, {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": "application/json" },
    credentials,
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
      if (size > SERVICE_PACKAGE_LIMITS.resultBytes + 1024)
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
