import { AssistantServiceError, type AssistantServiceErrorCode } from "../../domain/assistant/failure";
import { assistantServiceErrorDefinition } from "../../../../packages/pvo-assistant/service-errors.js";

/** Bound response decoding too; release the reader immediately on cancellation. */
export async function readAssistantJson(response: Response, signal: AbortSignal, maximumBytes = 96 * 1024): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new AssistantServiceError(422, undefined, "model_output_invalid");
  const reader = response.body?.getReader();
  if (!reader) throw new AssistantServiceError(422, undefined, "model_output_invalid");
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
        throw new AssistantServiceError(422, undefined, "model_output_invalid");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new AssistantServiceError(422, undefined, "model_output_invalid"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Only recognized structured reasons affect UI; upstream messages never cross this boundary. */
export async function assistantServiceFailure(response: Response, signal: AbortSignal): Promise<AssistantServiceError> {
  let code: AssistantServiceErrorCode | undefined;
  try {
    if (response.status === 429 || response.status === 422) {
      const result = await readAssistantJson(response, signal, 4096);
      if (result && typeof result === "object" && "code" in result)
        code = assistantServiceErrorDefinition(result.code, response.status)?.code;
    }
  } catch {
    signal.throwIfAborted();
  } finally {
    await response.body?.cancel().catch(() => {});
  }
  return new AssistantServiceError(response.status, undefined, code);
}
