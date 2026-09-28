import { HttpError } from "../http.js";

export function publicationInput(value, maxBytes) {
  if (!value || typeof value !== "object") throw new HttpError(400, "Publication details are required.");
  const { format, size, idempotencyKey } = value;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const filename = typeof value.filename === "string" ? value.filename.trim() : "";
  const contentType = typeof value.contentType === "string" ? value.contentType.split(";", 1)[0].trim().toLowerCase() : "";
  if (!title || title.length > 120 || !filename || filename.length > 180 || /[\r\n\u0000]/.test(title + filename))
    throw new HttpError(400, "Add a title of up to 120 characters and a valid filename.");
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes)
    throw new HttpError(413, `Online sharing supports files up to ${Math.floor(maxBytes / 1048576)} MiB.`);
  if ((format !== "video" && format !== "pvo") || (format === "pvo" ? contentType !== "application/vnd.pvo"
    : !["video/mp4", "video/webm"].includes(contentType)))
    throw new HttpError(415, "Share an exported MP4, WebM or PVO file.");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
    throw new HttpError(400, "A valid upload idempotency key is required.");
  return { title, filename, format, size, contentType, idempotencyKey };
}

export function samePublication(row, input) {
  return row.title === input.title && row.filename === input.filename && row.format === input.format
    && row.content_type === input.contentType && row.bytes === input.size;
}

export function publicationResult(row, origin) {
  return { id: row.id, url: `${origin}/player/${row.id}`, status: row.status };
}
