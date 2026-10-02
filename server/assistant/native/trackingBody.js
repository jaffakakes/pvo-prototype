import { HttpError } from "../../http.js";

/** Bound both bytes and lifetime, including peers whose response stream ignores fetch abort. */
export async function readTrackingJson(source, maximum, signal) {
  if (source.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new HttpError(415, "Send application/json.");
  const reader = source.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413, "The tracking data is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new HttpError(400, "The tracking data must contain valid JSON."); }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
