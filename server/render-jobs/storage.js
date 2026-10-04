import { HttpError } from "../http.js";

const MAX_RESULT_BYTES = 200 * 1024 * 1024;

export async function putExact(request, bucket, key, bytes, contentType, timeoutMs = 15 * 60 * 1000) {
  if (!request.body) throw new HttpError(400, "The source file is missing.");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) !== bytes)
    throw new HttpError(400, "The uploaded file size differs from the render request.");
  const fixed = new FixedLengthStream(bytes);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let pumping;
  let storing;
  try {
    pumping = request.body.pipeTo(fixed.writable, { signal: abort.signal });
    storing = bucket.put(key, fixed.readable, {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType },
    });
    const [, stored] = await Promise.all([pumping, storing]);
    if (!stored) throw new HttpError(409, "This file is already uploading or was uploaded.");
    if (stored.size !== bytes) throw new HttpError(400, "The uploaded file is incomplete.");
    return stored;
  } catch (error) {
    abort.abort();
    await Promise.allSettled([pumping, storing]);
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The upload was interrupted or its size changed. Please retry.");
  } finally {
    clearTimeout(timer);
  }
}

export function resultLength(request) {
  const bytes = Number(request.headers.get("Content-Length"));
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_RESULT_BYTES)
    throw new HttpError(413, "The rendered video is too large.");
  return bytes;
}

export async function inspectSource(bucket, key) {
  const object = await bucket.get(key, { range: { offset: 0, length: 16 } });
  if (!object) return false;
  const bytes = new Uint8Array(await object.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  return text.slice(4, 8) === "ftyp"
    || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    || text.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    || (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE");
}
