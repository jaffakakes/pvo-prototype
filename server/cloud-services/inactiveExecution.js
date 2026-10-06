import { withAssistantDeadline } from "../assistant/deadline.js";
import { INACTIVE_SERVICE_LIMITS as limits } from "../../packages/pvo-assistant/releases/index.js";

async function readOutput(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limits.outputBytes) {
        await reader.cancel();
        throw new Error("Inactive service output exceeded its limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Authoring probe only. Public activation, live records and integrations are separate capabilities. */
export async function probeInactiveService(loader, publication, input) {
  const body = JSON.stringify(input);
  if (
    typeof body !== "string" ||
    new TextEncoder().encode(body).length > limits.inputBytes
  )
    throw new Error("Inactive service input exceeded its limit.");
  return withAssistantDeadline(async (signal) => {
    const worker = loader.get(
      `${publication.identity.resourceId}:${publication.identity.sourceDigest}`,
      () => ({
        compatibilityDate: "2026-10-03",
        mainModule: "service.js",
        modules: { "service.js": publication.source },
        env: {},
        globalOutbound: null,
        limits: { cpuMs: limits.cpuMs, subRequests: 0 },
      }),
    );
    const response = await worker.getEntrypoint().fetch(
      new Request("https://service.invalid/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      }),
    );
    const output = await readOutput(response, signal);
    return { status: response.status, body: output };
  }, limits.probeMs);
}
