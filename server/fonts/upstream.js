import { HttpError } from "../http.js";

/** Font hosts are fixed by the adapter; user input can never choose a destination. */
export async function fontBytes(url, limit, { fetch: request = fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const response = await request(url, { redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(502, "The font provider is unavailable. Try again.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "The font provider returned an empty file.");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new HttpError(413, "This font is too large to save.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function fontText(url, limit, options) {
  return new TextDecoder().decode(await fontBytes(url, limit, options));
}
