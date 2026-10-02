import { AssistantServiceError, type AssistantServiceErrorCode } from "../../domain/assistant/failure";

/** Bound response decoding too; release the reader immediately on cancellation. */
export async function readAssistantJson(response: Response, signal: AbortSignal, maximumBytes = 96 * 1024): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new Error("The assistant did not return a JSON result.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The assistant returned an empty result.");
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("The assistant result is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Only recognized structured reasons affect UI; upstream messages never cross this boundary. */
export async function assistantServiceFailure(response: Response, signal: AbortSignal): Promise<AssistantServiceError> {
  let code: AssistantServiceErrorCode | undefined;
  try {
    if (response.status === 429) {
      const result = await readAssistantJson(response, signal, 4096);
      if (result && typeof result === "object" && "code" in result && result.code === "provider_allowance_exhausted")
        code = result.code;
    }
  } catch {
    signal.throwIfAborted();
  } finally {
    await response.body?.cancel().catch(() => {});
  }
  return new AssistantServiceError(response.status, code ? "The AI provider's allowance has been used up." : undefined, code);
}
