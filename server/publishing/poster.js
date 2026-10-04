import { HttpError } from "../http.js";

export const MAX_POSTER_BYTES = 5 * 1024 * 1024;
export const posterKey = (publicationId) => `posters/${publicationId}`;

export function isWebp(bytes) {
  if (bytes.length < 12) return false;
  const text = new TextDecoder().decode(bytes.subarray(0, 12));
  return text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
}

async function readPoster(request) {
  const type = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "image/webp") throw new HttpError(415, "The cover must be a WebP image.");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_POSTER_BYTES))
    throw new HttpError(413, "The cover image is too large.");
  if (!request.body) throw new HttpError(400, "A cover image is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_POSTER_BYTES) throw new HttpError(413, "The cover image is too large.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  if (!size || (declared !== null && Number(declared) !== size))
    throw new HttpError(400, "The cover image is incomplete.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!isWebp(bytes)) throw new HttpError(415, "The cover image is not a WebP file.");
  return bytes;
}

/** A ready publication may receive one immutable owner-uploaded poster. */
export async function uploadPoster(request, env, publication) {
  if (publication.status !== "ready") throw new HttpError(409, "Upload the exported file before its cover.");
  const bytes = await readPoster(request);
  const key = posterKey(publication.id);
  const saved = await env.MEDIA.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/webp" },
  });
  if (!saved && !await env.MEDIA.head(key))
    throw new HttpError(503, "The cover image could not be saved. Please retry.");
  return { uploaded: true };
}
