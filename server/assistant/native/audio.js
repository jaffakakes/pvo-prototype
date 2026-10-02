import { HttpError } from "../../http.js";

export const MAX_AUDIO_SECONDS = 60;
export const MAX_AUDIO_BYTES = MAX_AUDIO_SECONDS * 16000 * 2 + 4096;

/** Verify actual WAV metadata, not the client-supplied duration or MIME type. */
export function parseTranscriptionAudio(bytes) {
  const invalid = () => new HttpError(400, "Send up to 60 seconds of mono 16 kHz PCM WAV audio.");
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_AUDIO_BYTES) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (label(0) !== "RIFF" || label(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.byteLength) throw invalid();
  let format = false;
  let audioBytes = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset + 4, true);
    const end = offset + 8 + length;
    if (end > bytes.byteLength) throw invalid();
    if (label(offset) === "fmt ") {
      if (format || length < 16 || view.getUint16(offset + 8, true) !== 1
        || view.getUint16(offset + 10, true) !== 1 || view.getUint32(offset + 12, true) !== 16000
        || view.getUint32(offset + 16, true) !== 32000 || view.getUint16(offset + 20, true) !== 2
        || view.getUint16(offset + 22, true) !== 16) throw invalid();
      format = true;
    }
    if (label(offset) === "data") {
      if (audioBytes !== null || !length || length % 2) throw invalid();
      audioBytes = length;
    }
    offset = end + (length % 2);
  }
  if (offset !== bytes.byteLength || !format || audioBytes === null) throw invalid();
  const duration = audioBytes / 32000;
  if (duration > MAX_AUDIO_SECONDS) throw invalid();
  return { duration };
}

export async function readTranscriptionAudio(request) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "audio/wav")
    throw new HttpError(415, "Send audio/wav.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Audio is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Transcribe at most 60 seconds of audio at a time.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const { duration } = parseTranscriptionAudio(bytes);
  const reported = request.headers.get("X-Audio-Duration");
  if (reported !== null && (!Number.isFinite(Number(reported)) || Math.abs(Number(reported) - duration) > 0.02))
    throw new HttpError(400, "The audio duration does not match its WAV data.");
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { audio: btoa(binary), duration };
}

export function parseTranscriptionResult(result, duration) {
  const invalid = () => new HttpError(422, "The assistant could not produce a valid transcript. Try a shorter range.");
  if (!result || typeof result.text !== "string" || result.text.length > 20000) throw invalid();
  if (result.segments !== undefined && (!Array.isArray(result.segments) || result.segments.length > 300)) throw invalid();
  const segments = (result.segments ?? []).map(segment => {
    if (!segment || typeof segment.text !== "string" || segment.text.length > 2000
      || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.start > duration || segment.end < segment.start
      || segment.end > duration + 0.05) throw invalid();
    return { start: segment.start, end: Math.min(segment.end, duration), text: segment.text };
  });
  return { text: result.text, segments };
}
