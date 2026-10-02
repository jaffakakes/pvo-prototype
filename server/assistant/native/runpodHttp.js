import { HttpError } from "../../http.js";

const invalidResponse = () => new HttpError(422, "The assistant provider returned an invalid result. Try again.");

/** Bound provider output while preserving caller cancellation through body decoding. */
async function readRunpodJson(response, signal, maxBytes) {
  if (response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    throw invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0;
  const chunks = [];
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw invalidResponse();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidResponse(); }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof HttpError) throw error;
    throw invalidResponse();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Server-owned Runpod paths only; never follow a redirect with the API key. */
export async function requestRunpodJson(path, payload, apiKey, signal, {
  fetch: send = globalThis.fetch, method = "POST", maxBytes = 128 * 1024,
} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new HttpError(503, "The assistant model is not configured.");
  if (!/^\/v2\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/.test(path)
    || !["POST", "GET"].includes(method) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024)
    throw new HttpError(503, "The assistant provider is not configured correctly.");
  signal.throwIfAborted();
  let response;
  try {
    response = await send(`https://api.runpod.ai${path}`, {
      method, redirect: "manual", signal,
      headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    signal.throwIfAborted();
  } catch {
    signal.throwIfAborted();
    throw new HttpError(503, "The assistant model is unavailable. Please try again later.");
  }
  // Workers fetch supports manual redirects. Reject every non-success response
  // ourselves so credentials never follow a provider redirect.
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    console.warn(JSON.stringify({ operation: "native-assistant", provider: "runpod", status: response.status }));
    if (response.status === 429) throw new HttpError(429, "The assistant is busy. Please try again later.");
    throw new HttpError(503, "The assistant model is unavailable. Please try again later.");
  }
  return readRunpodJson(response, signal, maxBytes);
}
