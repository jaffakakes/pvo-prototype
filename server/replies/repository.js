import { HttpError } from "../http.js";
import { randomId } from "../identity.js";

import {
  REPLY_BOX_LIFETIME_MS,
  MAX_BOXES_PER_OWNER,
  MAX_REPLIES_PER_BOX,
  MAX_REPLIES_PER_BOX_DAY,
  MAX_REPLIES_PER_BOX_MINUTE,
  MAX_REPLIES_PER_SOURCE_DAY,
} from "./limits.js";

export async function createReplyBox(
  db,
  ownerId,
  title,
  origin,
  now = Date.now(),
) {
  const id = randomId();
  const result = await db
    .prepare(
      `INSERT INTO reply_boxes (id, owner_id, title, created_at, expires_at)
    SELECT ?, id, ?, ?, ? FROM users WHERE id = ?
      AND (SELECT COUNT(*) FROM reply_boxes WHERE owner_id = ? AND expires_at > ?) < ?`,
    )
    .bind(
      id,
      title,
      now,
      now + REPLY_BOX_LIFETIME_MS,
      ownerId,
      ownerId,
      now,
      MAX_BOXES_PER_OWNER,
    )
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      429,
      "Your reply box limit has been reached. Remove an older box first.",
    );
  return { id, title, url: `${origin}/api/reply-boxes/${id}/replies` };
}

export async function ownerReplyBoxes(db, ownerId, origin, now = Date.now()) {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.title, b.created_at,
      (SELECT COUNT(*) FROM replies WHERE box_id = b.id) AS count
    FROM reply_boxes b WHERE b.owner_id = ? AND b.expires_at > ?
    ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
    )
    .bind(ownerId, now, MAX_BOXES_PER_OWNER)
    .all();
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    count: row.count,
    url: `${origin}/api/reply-boxes/${row.id}/replies`,
  }));
}

export async function ownedReplyBox(db, id, ownerId, now = Date.now()) {
  const box = await db
    .prepare(
      "SELECT id FROM reply_boxes WHERE id = ? AND owner_id = ? AND expires_at > ?",
    )
    .bind(id, ownerId, now)
    .first();
  if (!box) throw new HttpError(404, "This reply box is unavailable.");
  return box;
}

export async function ownerReplies(db, boxId, ownerId, now = Date.now()) {
  await ownedReplyBox(db, boxId, ownerId, now);
  const { results } = await db
    .prepare(
      `SELECT id, created_at, answers_json FROM replies
    WHERE box_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(boxId, MAX_REPLIES_PER_BOX)
    .all();
  return results.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    answers: JSON.parse(row.answers_json),
  }));
}

export async function submitReply(
  db,
  boxId,
  answers,
  sourceHash,
  now = Date.now(),
) {
  const result = await db
    .prepare(
      `INSERT INTO replies (id, box_id, answers_json, source_hash, created_at)
    SELECT ?, b.id, ?, ?, ? FROM reply_boxes b
    WHERE b.id = ? AND b.expires_at > ?
      AND (SELECT COUNT(*) FROM replies WHERE box_id = b.id) < ?
      AND (SELECT COUNT(*) FROM replies WHERE box_id = b.id AND created_at >= ?) < ?
      AND (SELECT COUNT(*) FROM replies WHERE box_id = b.id AND created_at >= ?) < ?
      AND (? IS NULL OR (SELECT COUNT(*) FROM replies
        WHERE box_id = b.id AND source_hash = ? AND created_at >= ?) < ?)`,
    )
    .bind(
      randomId(),
      JSON.stringify(answers),
      sourceHash,
      now,
      boxId,
      now,
      MAX_REPLIES_PER_BOX,
      now - 86400000,
      MAX_REPLIES_PER_BOX_DAY,
      now - 60000,
      MAX_REPLIES_PER_BOX_MINUTE,
      sourceHash,
      sourceHash,
      Math.floor(now / 86400000) * 86400000,
      MAX_REPLIES_PER_SOURCE_DAY,
    )
    .run();
  if (result.meta.changes) return;
  const box = await db
    .prepare("SELECT id FROM reply_boxes WHERE id = ? AND expires_at > ?")
    .bind(boxId, now)
    .first();
  if (!box) throw new HttpError(404, "This reply box is unavailable.");
  throw new HttpError(
    429,
    "This reply box is receiving too many messages. Try again later.",
  );
}

export async function removeReplyBox(db, boxId, ownerId, now = Date.now()) {
  await ownedReplyBox(db, boxId, ownerId, now);
  await db.batch([
    db.prepare("DELETE FROM replies WHERE box_id = ?").bind(boxId),
    db
      .prepare("DELETE FROM reply_boxes WHERE id = ? AND owner_id = ?")
      .bind(boxId, ownerId),
  ]);
}

export async function cleanupReplyBoxes(db, now = Date.now()) {
  if (!db) return;
  await db.batch([
    db
      .prepare(
        `DELETE FROM replies WHERE created_at <= ? OR box_id IN
      (SELECT id FROM reply_boxes WHERE expires_at <= ?)`,
      )
      .bind(now - REPLY_BOX_LIFETIME_MS, now),
    db.prepare("DELETE FROM reply_boxes WHERE expires_at <= ?").bind(now),
  ]);
}
