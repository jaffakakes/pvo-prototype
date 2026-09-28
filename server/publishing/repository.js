import { randomId } from "../identity.js";
import { HttpError } from "../http.js";
import { samePublication } from "./input.js";

export async function reservePublication(db, owner, input, config, now = Date.now()) {
  const id = randomId();
  // The limits and reservation are one SQLite statement: concurrent creators
  // cannot each spend the same remaining storage quota.
  await db.prepare(`INSERT INTO publications
    (id, owner_id, idempotency_key, title, filename, format, content_type, bytes, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE COALESCE((SELECT SUM(bytes) FROM publications WHERE owner_id = ? AND status != 'deleted'), 0) + ? <= ?
      AND COALESCE((SELECT SUM(bytes) FROM publications WHERE status != 'deleted'), 0) + ? <= ?
      AND (SELECT COUNT(*) FROM publications WHERE owner_id = ? AND created_at >= ?) < ?
    ON CONFLICT(owner_id, idempotency_key) DO NOTHING`)
    .bind(id, owner, input.idempotencyKey, input.title, input.filename, input.format, input.contentType, input.size,
      now, now + config.pendingMs, owner, input.size, config.ownerQuota, input.size, config.totalQuota,
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

export async function beginAttempt(db, publication, config, now = Date.now()) {
  const attempt = { id: randomId(), key: `exports/${publication.id}/${randomId(24)}`, expires: now + config.uploadMs + 60000 };
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

export async function finishAttempt(db, publication, attempt, verifiedType) {
  const result = await db.prepare(`UPDATE publications SET status = 'ready', object_key = ?, content_type = ?, active_attempt = NULL
    WHERE id = ? AND status = 'pending' AND active_attempt = ? AND expires_at > ?`)
    .bind(attempt.key, verifiedType, publication.id, attempt.id, Date.now()).run();
  return result.meta.changes > 0;
}

export async function discardAttempt(db, bucket, publicationId, attempt) {
  // Remove storage before releasing the lease/quota. A failed deletion leaves
  // the attempt discoverable by scheduled cleanup and blocks another upload.
  await bucket.delete(attempt.key);
  await db.batch([
    db.prepare("UPDATE publications SET active_attempt = NULL WHERE id = ? AND active_attempt = ?")
      .bind(publicationId, attempt.id),
    db.prepare("DELETE FROM upload_attempts WHERE id = ?").bind(attempt.id),
  ]);
}
