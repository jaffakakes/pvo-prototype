import type { serviceSubmissionRequest } from "../../../../packages/pvo-assistant/attachments/index.js";
import { SERVICE_PACKAGE_LIMITS } from "../../../../packages/pvo-assistant/services/index.js";

/** Retains HTTP status for the SDK's existing request feedback without exposing response bodies. */
export class ComponentTestHttpError extends Error {
  constructor(readonly status: number) {
    super("The component test request failed.");
  }
}

/** Only the fixed same-origin component test route receives a creator session. */
export async function sendComponentTest(
  request: ReturnType<typeof serviceSubmissionRequest>,
  origin: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = new URL(request.url);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/services\/service-[a-f0-9]{64}\/releases\/release-[a-f0-9]{64}\/try$/.test(
      url.pathname,
    ) ||
    request.method !== "POST"
  )
    throw new Error("Invalid component test destination.");
  signal?.throwIfAborted();
  const response = await fetcher(url.href, {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
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
    if (!response.ok) throw new ComponentTestHttpError(response.status);
    throw new Error("The component test returned an invalid response.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The component test returned no response.");
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > SERVICE_PACKAGE_LIMITS.resultBytes + 512)
        throw new Error("The component test response is too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
