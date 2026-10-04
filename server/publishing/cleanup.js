import { discardAttempt } from "./repository.js";
import { posterKey } from "./poster.js";

export async function cleanPublication(env, id, now = Date.now()) {
  const publication = await env.DB.prepare("SELECT * FROM publications WHERE id = ?").bind(id).first();
  if (!publication) return;
  const { results } = await env.DB.prepare("SELECT * FROM upload_attempts WHERE publication_id = ?").bind(id).all();
  for (const attempt of results) {
    if (publication.status === "ready" && publication.object_key === attempt.object_key) continue;
    if (publication.active_attempt === attempt.id && attempt.expires_at > now) continue;
    if (publication.status === "pending" && attempt.expires_at > now) continue;
    try {
      await discardAttempt(env.DB, env.MEDIA, id, { id: attempt.id, key: attempt.object_key });
    } catch { console.error("Publication storage cleanup deferred", id, attempt.id); }
  }
  if (publication.status === "deleting") {
    try { await env.MEDIA.delete(posterKey(id)); }
    catch { console.error("Publication poster cleanup deferred", id); return; }
  }
  await env.DB.prepare(`UPDATE publications SET status = 'deleted', object_key = NULL, active_attempt = NULL
    WHERE id = ? AND status = 'deleting' AND NOT EXISTS
    (SELECT 1 FROM upload_attempts WHERE publication_id = ?)`)
    .bind(id, id).run();
}

export async function cleanupPublications(env, now = Date.now()) {
  if (!env.DB || !env.MEDIA) return;
  await env.DB.prepare("UPDATE publications SET status = 'deleting' WHERE status = 'pending' AND expires_at <= ?").bind(now).run();
  const { results } = await env.DB.prepare(`SELECT DISTINCT p.id FROM publications p LEFT JOIN upload_attempts a ON a.publication_id = p.id
    WHERE p.status = 'deleting' OR (a.expires_at <= ? AND (p.status != 'ready' OR a.object_key != p.object_key)) LIMIT 100`)
    .bind(now).all();
  for (const row of results) await cleanPublication(env, row.id, now);
  // Reconcile objects left after a process ended between R2 and D1 operations.
  // The cursor prevents live objects at the start of the bucket starving cleanup.
  const saved = await env.DB.prepare("SELECT value FROM maintenance_state WHERE name = 'orphan-cursor'").first();
  const objects = await env.MEDIA.list({ prefix: "exports/", limit: 100, ...(saved?.value ? { cursor: saved.value } : {}) });
  for (const object of objects.objects) {
    if (object.uploaded.getTime() > now - 86400000) continue;
    const referenced = await env.DB.prepare(`SELECT 1 AS found FROM publications WHERE object_key = ? AND status = 'ready'
      UNION ALL SELECT 1 AS found FROM upload_attempts WHERE object_key = ? LIMIT 1`).bind(object.key, object.key).first();
    if (!referenced) await env.MEDIA.delete(object.key);
  }
  await env.DB.prepare(`INSERT INTO maintenance_state (name, value) VALUES ('orphan-cursor', ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value`).bind(objects.truncated ? objects.cursor : "").run();

  // A deletion racing a cover upload may leave a deterministic poster object.
  const posterCursor = await env.DB.prepare("SELECT value FROM maintenance_state WHERE name = 'orphan-poster-cursor'").first();
  const posters = await env.MEDIA.list({ prefix: "posters/", limit: 100,
    ...(posterCursor?.value ? { cursor: posterCursor.value } : {}) });
  for (const object of posters.objects) {
    if (object.uploaded.getTime() > now - 86400000) continue;
    const id = object.key.slice("posters/".length);
    const ready = await env.DB.prepare("SELECT 1 AS found FROM publications WHERE id = ? AND status = 'ready'").bind(id).first();
    if (!ready) await env.MEDIA.delete(object.key);
  }
  await env.DB.prepare(`INSERT INTO maintenance_state (name, value) VALUES ('orphan-poster-cursor', ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value`).bind(posters.truncated ? posters.cursor : "").run();
}
