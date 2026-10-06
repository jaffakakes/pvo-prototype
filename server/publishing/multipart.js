import { HttpError } from "../http.js";
import { activeMultipartAttempt, attachMultipartUpload, beginAttempt, discardAttempt,
  finishAttempt, renewMultipartAttempt } from "./repository.js";
import { inspectUpload } from "./inspect-upload.js";

const MIB = 1024 * 1024;
const MIN_PART_BYTES = 8 * MIB;
const MAX_PART_BYTES = 64 * MIB;
const MAX_PARTS = 10000;

function chunkBytes(size) {
  return Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS / MIB) * MIB);
}

function ensurePending(publication) {
  if (publication.status !== "pending" || publication.expires_at <= Date.now())
    throw new HttpError(410, "This upload expired or was removed. Start a new link.");
}

async function currentAttempt(env, publication) {
  ensurePending(publication);
  const attempt = await activeMultipartAttempt(env.DB, publication);
  if (!attempt || attempt.expired)
    throw new HttpError(409, "Start this upload again before sending parts.");
  return attempt;
}

export async function beginMultipartUpload(env, config, publication) {
  ensurePending(publication);
  const previous = await activeMultipartAttempt(env.DB, publication);
  if (previous?.expired) await discardAttempt(env.DB, env.MEDIA, publication.id, previous);
  else if (previous) return { chunkBytes: chunkBytes(publication.bytes) };
  const attempt = await beginAttempt(env.DB, publication, config, Date.now(), config.multipartMs);
  let upload;
  try {
    upload = await env.MEDIA.createMultipartUpload(attempt.key);
    await attachMultipartUpload(env.DB, publication, attempt, upload.uploadId);
    return { chunkBytes: chunkBytes(publication.bytes) };
  } catch (error) {
    if (upload) await upload.abort().catch(() => {});
    await discardAttempt(env.DB, env.MEDIA, publication.id, attempt).catch(() => {});
    throw error;
  }
}

async function readExactPart(request, expected) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) !== expected)
    throw new HttpError(400, "This upload part has the wrong size.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "An upload part is required.");
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected)
        throw new HttpError(400, "This upload part is larger than expected.");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (offset !== expected) throw new HttpError(400, "This upload part is incomplete.");
  return bytes;
}

export async function uploadMultipartPart(request, env, config, publication, numberText) {
  const partNumber = Number(numberText);
  const size = chunkBytes(publication.bytes);
  const count = Math.ceil(publication.bytes / size);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count || String(partNumber) !== numberText)
    throw new HttpError(400, "This upload part number is invalid.");
  const expected = Math.min(size, publication.bytes - (partNumber - 1) * size);
  const attempt = await currentAttempt(env, publication);
  const bytes = await readExactPart(request, expected);
  await renewMultipartAttempt(env.DB, publication, attempt, Date.now(), config);
  const part = await env.MEDIA.resumeMultipartUpload(attempt.object_key, attempt.upload_id)
    .uploadPart(partNumber, bytes);
  return { partNumber: part.partNumber, etag: part.etag };
}

function checkedParts(value, bytes) {
  const count = Math.ceil(bytes / chunkBytes(bytes));
  if (!value || typeof value !== "object" || !Array.isArray(value.parts) || value.parts.length !== count)
    throw new HttpError(400, "The uploaded parts are incomplete.");
  return value.parts.map((part, index) => {
    if (!part || part.partNumber !== index + 1 || typeof part.etag !== "string"
      || !/^[A-Za-z0-9"_-]{1,256}$/.test(part.etag))
      throw new HttpError(400, "The uploaded parts are invalid.");
    return { partNumber: part.partNumber, etag: part.etag };
  });
}

export async function completeMultipartUpload(env, config, publication, value) {
  if (publication.status === "ready") return publication;
  const parts = checkedParts(value, publication.bytes);
  const attempt = await currentAttempt(env, publication);
  await renewMultipartAttempt(env.DB, publication, attempt, Date.now(), config);
  let stored = await env.MEDIA.head(attempt.object_key);
  if (!stored) {
    try { stored = await env.MEDIA.resumeMultipartUpload(attempt.object_key, attempt.upload_id).complete(parts); }
    catch (error) {
      stored = await env.MEDIA.head(attempt.object_key);
      if (!stored) throw error;
    }
  }
  if (stored.size !== publication.bytes) {
    await discardAttempt(env.DB, env.MEDIA, publication.id, attempt);
    throw new HttpError(400, "The uploaded file is incomplete. Start a new link.");
  }
  try {
    const verifiedType = await inspectUpload(env.MEDIA, attempt.object_key, publication);
    if (!await finishAttempt(env.DB, publication, { ...attempt, key: attempt.object_key }, verifiedType))
      throw new HttpError(409, "This publication was cancelled before the upload finished.");
    return { ...publication, status: "ready", object_key: attempt.object_key, content_type: verifiedType };
  } catch (error) {
    const current = await env.DB.prepare("SELECT object_key, status FROM publications WHERE id = ?")
      .bind(publication.id).first();
    if (current?.status === "ready" && current.object_key === attempt.object_key)
      return { ...publication, status: "ready", object_key: attempt.object_key };
    await discardAttempt(env.DB, env.MEDIA, publication.id, attempt).catch(() => {});
    throw error;
  }
}
