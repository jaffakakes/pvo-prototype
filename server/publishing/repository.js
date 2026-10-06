import { randomId } from "../identity.js";
import { HttpError } from "../http.js";
import { samePublication } from "./input.js";

export async function reservePublication(db, owner, input, config, now = Date.now()) {
  const id = randomId();
  // Idempotency and the daily link creation allowance are enforced in the
  // reservation statement. Storage capacity is managed by the bucket.
  await db.prepare(`INSERT INTO publications
    (id, owner_id, idempotency_key, title, filename, format, content_type, bytes, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM publications WHERE owner_id = ? AND created_at >= ?) < ?
    ON CONFLICT(owner_id, idempotency_key) DO NOTHING`)
    .bind(id, owner, input.idempotencyKey, input.title, input.filename, input.format, input.contentType, input.size,
      now, now + config.pendingMs,
      owner, now - 86400000, config.dailyPublications).run();
  const row = await db.prepare("SELECT * FROM publications WHERE owner_id = ? AND idempotency_key = ?")
    .bind(owner, input.idempotencyKey).first();
  if (!row) throw new HttpError(429, "Your sharing limit has been reached. Remove older links or try again later.");
  if (!samePublication(row, input)) throw new HttpError(409, "This upload key already belongs to another export.");
  if (row.status === "deleted" || row.status === "deleting" || (row.status === "pending" && row.expires_at <= now))
    throw new HttpError(410, "This upload expired or was removed. Start a new link.");
  return row;
}

export async function ownedPublication(db, id, owner) {
  const row = await db.prepare("SELECT * FROM publications WHERE id = ? AND owner_id = ? AND status != 'deleted'")
    .bind(id, owner).first();
  if (!row) throw new HttpError(404, "This publication is unavailable.");
  return row;
}

export async function beginAttempt(db, publication, config, now = Date.now(), leaseMs = config.uploadMs) {
  const attempt = { id: randomId(), key: `exports/${publication.id}/${randomId(24)}`, expires: now + leaseMs + 60000 };
  // A lease permits only one active object per reserved publication. Every retry
  // after a failed attempt receives a new key; ready objects are never replaced.
  const results = await db.batch([
    db.prepare(`UPDATE publications SET active_attempt = ? WHERE id = ? AND status = 'pending'
      AND active_attempt IS NULL AND expires_at > ?`).bind(attempt.id, publication.id, now),
    db.prepare(`INSERT INTO upload_attempts (id, publication_id, object_key, expires_at, created_at)
      SELECT ?, id, ?, ?, ? FROM publications WHERE id = ? AND active_attempt = ?`)
      .bind(attempt.id, attempt.key, attempt.expires, now, publication.id, attempt.id),
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, "An upload is already in progress. Please retry shortly.");
  return attempt;
}

export async function activeMultipartAttempt(db, publication, now = Date.now()) {
  if (!publication.active_attempt) return null;
  const attempt = await db.prepare(`SELECT id, object_key, upload_id, expires_at FROM upload_attempts
    WHERE id = ? AND publication_id = ?`).bind(publication.active_attempt, publication.id).first();
  if (!attempt) throw new HttpError(409, "The previous upload is settling. Try again shortly.");
  if (attempt.expires_at <= now) return { ...attempt, expired: true };
  if (!attempt.upload_id) throw new HttpError(409, "An upload is already in progress. Try again shortly.");
  return attempt;
}

export async function attachMultipartUpload(db, publication, attempt, uploadId) {
  const result = await db.prepare(`UPDATE upload_attempts SET upload_id = ? WHERE id = ? AND publication_id = ?
    AND upload_id IS NULL AND EXISTS (SELECT 1 FROM publications WHERE id = ? AND active_attempt = ? AND status = 'pending')`)
    .bind(uploadId, attempt.id, publication.id, publication.id, attempt.id).run();
  if (!result.meta.changes) throw new HttpError(409, "The upload was cancelled before it started.");
}

export async function renewMultipartAttempt(db, publication, attempt, now, config) {
  const results = await db.batch([
    db.prepare(`UPDATE publications SET expires_at = ? WHERE id = ? AND active_attempt = ?
      AND status = 'pending' AND expires_at > ?`).bind(now + config.pendingMs, publication.id, attempt.id, now),
    db.prepare(`UPDATE upload_attempts SET expires_at = ? WHERE id = ? AND publication_id = ?
      AND expires_at > ? AND EXISTS (SELECT 1 FROM publications WHERE id = ? AND active_attempt = ? AND status = 'pending')`)
      .bind(now + config.multipartMs + 60000, attempt.id, publication.id, now, publication.id, attempt.id),
  ]);
  if (!results.every(result => result.meta.changes))
    throw new HttpError(410, "The upload expired or was cancelled. Start a new link.");
}

export async function finishAttempt(db, publication, attempt, verifiedType) {
  const result = await db.prepare(`UPDATE publications SET status = 'ready', object_key = ?, content_type = ?, active_attempt = NULL
    WHERE id = ? AND status = 'pending' AND active_attempt = ? AND expires_at > ?`)
    .bind(attempt.key, verifiedType, publication.id, attempt.id, Date.now()).run();
  return result.meta.changes > 0;
}

export async function discardAttempt(db, bucket, publicationId, attempt) {
  // Remove storage before releasing the lease/quota. A failed deletion leaves
  // the attempt discoverable by scheduled cleanup and blocks another upload.
  const key = attempt.key ?? attempt.object_key;
  if (attempt.upload_id) {
    try { await bucket.resumeMultipartUpload(key, attempt.upload_id).abort(); }
    catch (error) {
      // A completed upload has an object to delete. An unfinished upload with
      // an abort error must remain discoverable for scheduled cleanup.
      if (!await bucket.head(key)) throw error;
    }
  }
  await bucket.delete(key);
  await db.batch([
    db.prepare("UPDATE publications SET active_attempt = NULL WHERE id = ? AND active_attempt = ?")
      .bind(publicationId, attempt.id),
    db.prepare("DELETE FROM upload_attempts WHERE id = ?").bind(attempt.id),
  ]);
}
