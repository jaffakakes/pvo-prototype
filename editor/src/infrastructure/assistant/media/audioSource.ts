import { cancellable, projectMediaUrl } from "./lifecycle";

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_AUDIO_SOURCE_SECONDS = 600;

async function sourceBytes(url: string, send: typeof fetch, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await cancellable(send(projectMediaUrl(url), { credentials: "omit", redirect: "error", signal }), signal);
  if (!response.ok || !response.body) throw new Error("A project audio source could not be read.");
  if (Number(response.headers.get("Content-Length")) > MAX_SOURCE_BYTES) {
    await response.body.cancel();
    throw new Error("This source is too large for browser transcription. Import a shorter source file.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const result = await cancellable(reader.read(), signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_SOURCE_BYTES) throw new Error("This source is too large for browser transcription. Import a shorter source file.");
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

/** Bound fetching and decoding identically for scene transcription and source alignment. */
export async function loadAssistantAudioSource(
  audio: OfflineAudioContext,
  source: { id: number; url: string; sourceDuration: number },
  { signal, fetch: send, remainingBytes = MAX_SOURCE_BYTES }: { signal?: AbortSignal; fetch: typeof fetch; remainingBytes?: number },
): Promise<{ buffer: AudioBuffer; byteLength: number }> {
  signal?.throwIfAborted();
  if (source.sourceDuration > MAX_AUDIO_SOURCE_SECONDS)
    throw new Error("This source is too long for browser transcription. Import a source under ten minutes.");
  const bytes = await sourceBytes(source.url, send, signal);
  // decodeAudioData can detach its input; retain the actual fetch size before decoding.
  const byteLength = bytes.byteLength;
  if (byteLength > remainingBytes) throw new Error("The selected range needs too much audio to decode. Choose fewer sources.");
  let buffer: AudioBuffer;
  try { buffer = await cancellable(audio.decodeAudioData(bytes), signal); }
  catch (error) {
    signal?.throwIfAborted();
    throw new Error(`Audio in source ${source.id} cannot be decoded by this browser.`, { cause: error });
  }
  if (buffer.duration > MAX_AUDIO_SOURCE_SECONDS || buffer.numberOfChannels > 8)
    throw new Error("This audio source exceeds the browser inspection limit.");
  return { buffer, byteLength };
}
