import { randomId } from "../identity.js";
import { HttpError } from "../http.js";

const DAY = 24 * 60 * 60 * 1000;
const RETENTION = DAY;

export async function createRenderJob(db, ownerId, input, now = Date.now()) {
  const id = randomId();
  const inserted = await db
    .prepare(
      `INSERT INTO render_jobs
    (id, owner_id, source_json, status, created_at, updated_at, expires_at)
    SELECT ?, ?, ?, 'uploading', ?, ?, ?
    WHERE (SELECT COUNT(*) FROM render_jobs WHERE owner_id = ? AND status IN ('uploading', 'queued', 'rendering')) < 2
      AND (SELECT COUNT(*) FROM render_jobs WHERE owner_id = ? AND created_at >= ?) < 20`,
    )
    .bind(
      id,
      ownerId,
      JSON.stringify(input.source),
      now,
      now,
      now + RETENTION,
      ownerId,
      ownerId,
      now - DAY,
    )
    .run();
  if (!inserted.meta.changes)
    throw new HttpError(
      429,
      "Two renders are already running, or your daily render limit was reached.",
    );
  try {
    if (input.assets.length)
      await db.batch(
        input.assets.map((asset) =>
          db
            .prepare(
              `INSERT INTO render_assets
      (job_id, id, object_key, bytes, content_type) VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              id,
              asset.id,
              `renders/${id}/sources/${asset.id}`,
              asset.bytes,
              asset.contentType,
            ),
        ),
      );
  } catch (error) {
    await db
      .prepare("DELETE FROM render_jobs WHERE id = ? AND owner_id = ?")
      .bind(id, ownerId)
      .run();
    throw error;
  }
  return { id, status: "uploading", progress: 0 };
}

export async function ownedRenderJob(db, id, ownerId) {
  const row = await db
    .prepare("SELECT * FROM render_jobs WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first();
  if (!row) throw new HttpError(404, "This render is unavailable.");
  return row;
}

export async function renderJob(db, id) {
  return db.prepare("SELECT * FROM render_jobs WHERE id = ?").bind(id).first();
}

export async function renderAssets(db, jobId) {
  const { results } = await db
    .prepare("SELECT * FROM render_assets WHERE job_id = ? ORDER BY id")
    .bind(jobId)
    .all();
  return results;
}

export async function beginAssetUpload(db, jobId, assetId, now = Date.now()) {
  const attempt = randomId();
  const updated = await db
    .prepare(
      `UPDATE render_assets SET active_upload = ?, active_upload_expires_at = ?
    WHERE job_id = ? AND id = ?
    AND (active_upload IS NULL OR active_upload_expires_at <= ?) AND uploaded_at IS NULL
    AND EXISTS (SELECT 1 FROM render_jobs WHERE id = ? AND status = 'uploading' AND expires_at > ?)`,
    )
    .bind(attempt, now + 16 * 60 * 1000, jobId, assetId, now, jobId, now)
    .run();
  if (!updated.meta.changes)
    throw new HttpError(
      409,
      "This source is already uploading or the render has ended.",
    );
  return attempt;
}

export async function markAssetUploaded(
  db,
  jobId,
  assetId,
  attempt,
  now = Date.now(),
) {
  const updated = await db
    .prepare(
      `UPDATE render_assets SET uploaded_at = ?, active_upload = NULL,
    active_upload_expires_at = NULL WHERE job_id = ? AND id = ?
    AND uploaded_at IS NULL AND active_upload = ?
    AND EXISTS (SELECT 1 FROM render_jobs WHERE id = ? AND status = 'uploading' AND expires_at > ?)`,
    )
    .bind(now, jobId, assetId, attempt, jobId, now)
    .run();
  return updated.meta.changes > 0;
}

export async function releaseAssetUpload(db, jobId, assetId, attempt) {
  await db
    .prepare(
      `UPDATE render_assets SET active_upload = NULL, active_upload_expires_at = NULL
    WHERE job_id = ? AND id = ?
    AND active_upload = ? AND uploaded_at IS NULL`,
    )
    .bind(jobId, assetId, attempt)
    .run();
}

export async function queueRenderJob(db, jobId, ownerId, now = Date.now()) {
  const updated = await db
    .prepare(
      `UPDATE render_jobs SET status = 'queued', updated_at = ?
    WHERE id = ? AND owner_id = ? AND status = 'uploading' AND expires_at > ?
    AND NOT EXISTS (SELECT 1 FROM render_assets WHERE job_id = ? AND uploaded_at IS NULL)`,
    )
    .bind(now, jobId, ownerId, now, jobId)
    .run();
  return updated.meta.changes > 0;
}

/** Queue delivery can fail after a consumer claimed the job; only queued work may fail here. */
export async function failQueuedRenderJob(db, jobId, message) {
  await db
    .prepare(
      `UPDATE render_jobs SET status = 'failed', error = ?
    WHERE id = ? AND status = 'queued'`,
    )
    .bind(message, jobId)
    .run();
}

export async function claimRenderJob(db, jobId, now = Date.now()) {
  const key = `renders/${jobId}/results/${randomId(24)}.mp4`;
  const updated = await db
    .prepare(
      `UPDATE render_jobs SET status = 'rendering', progress = 0.05,
    result_key = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND expires_at > ?`,
    )
    .bind(key, now, jobId, now)
    .run();
  return updated.meta.changes ? renderJob(db, jobId) : null;
}

export async function finishRenderJob(db, jobId, key, now = Date.now()) {
  const updated = await db
    .prepare(
      `UPDATE render_jobs SET status = 'ready', progress = 1, updated_at = ?
    WHERE id = ? AND status = 'rendering' AND result_key = ? AND expires_at > ?`,
    )
    .bind(now, jobId, key, now)
    .run();
  return updated.meta.changes > 0;
}

export async function updateRenderProgress(
  db,
  jobId,
  key,
  fraction,
  now = Date.now(),
) {
  const progress = Math.min(0.95, Math.max(0.05, 0.05 + 0.9 * fraction));
  await db
    .prepare(
      `UPDATE render_jobs SET progress = ?, updated_at = ?
    WHERE id = ? AND status = 'rendering' AND result_key = ? AND progress < ?`,
    )
    .bind(progress, now, jobId, key, progress)
    .run();
}

export async function failRenderJob(db, jobId, key, message, now = Date.now()) {
  await db
    .prepare(
      `UPDATE render_jobs SET status = 'failed', error = ?, progress = 0,
    updated_at = ? WHERE id = ? AND status = 'rendering' AND result_key = ?`,
    )
    .bind(message, now, jobId, key)
    .run();
}

export async function cancelRenderJob(db, jobId, ownerId, now = Date.now()) {
  await db
    .prepare(
      `UPDATE render_jobs SET status = 'cancelled', updated_at = ?
    WHERE id = ? AND owner_id = ? AND status != 'cancelled'`,
    )
    .bind(now, jobId, ownerId)
    .run();
}

export function publicRenderJob(row) {
  const result = { id: row.id, status: row.status, progress: row.progress };
  if (row.error && row.status === "failed") result.error = row.error;
  if (row.status === "ready")
    result.resultUrl = `/api/renders/${row.id}/result`;
  return result;
}
