import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { validPublicationId } from "../identity.js";
import { createSession, getSession } from "./sessions.js";
import { publicationInput, publicationResult } from "./input.js";
import { ownedPublication, reservePublication } from "./repository.js";
import { uploadPublication } from "./upload.js";
import { cleanPublication } from "./cleanup.js";

export async function publishingRoute(request, env, config) {
  const url = new URL(request.url);
  if (url.pathname === "/api/publishing" && request.method === "GET") {
    const owner = config.available ? await getSession(request, env) : null;
    return json({ available: config.available, hasSession: Boolean(owner), maxBytes: config.maxBytes });
  }
  if (!config.available) throw new HttpError(503, "Online sharing is not configured yet. Your download is still available.");
  if (request.method !== "GET") checkOrigin(request, config.origin);
  const owner = await getSession(request, env);
  if (url.pathname === "/api/publishing/session") {
    if (request.method !== "POST") throw new HttpError(405, "This publishing operation is not supported.");
    const cookie = owner ? null : await createSession(env);
    return json({ available: true, hasSession: true, maxBytes: config.maxBytes }, 200,
      cookie ? { "Set-Cookie": cookie } : {});
  }
  if (!owner) throw new HttpError(401, "Your link-sharing session expired. Try creating the link again.");
  if (url.pathname === "/api/publications") {
    if (request.method === "POST") {
      const input = publicationInput(await readJson(request), config.maxBytes);
      return json(publicationResult(await reservePublication(env.DB, owner.id, input, config), config.origin), 201);
    }
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(`SELECT id, title, format, bytes, created_at FROM publications
        WHERE owner_id = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 100`).bind(owner.id).all();
      return json({ publications: results.map(row => ({ id: row.id, title: row.title, format: row.format,
        bytes: row.bytes, createdAt: new Date(row.created_at).toISOString(), url: `${config.origin}/player/${row.id}` })) });
    }
    throw new HttpError(405, "This publication operation is not supported.");
  }
  const match = /^\/api\/publications\/([^/]+)(\/content)?$/.exec(url.pathname);
  if (!match || !validPublicationId(match[1])) throw new HttpError(404, "This publication is unavailable.");
  const publication = await ownedPublication(env.DB, match[1], owner.id);
  if (match[2] && request.method === "PUT")
    return json(publicationResult(await uploadPublication(request, env, config, publication), config.origin));
  if (!match[2] && request.method === "DELETE") {
    await env.DB.prepare("UPDATE publications SET status = 'deleting' WHERE id = ? AND owner_id = ?")
      .bind(publication.id, owner.id).run();
    await cleanPublication(env, publication.id);
    return json({ deleted: true });
  }
  throw new HttpError(405, "This publication operation is not supported.");
}
