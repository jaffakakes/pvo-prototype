import { escapeHtml, HttpError, notFound } from "../http.js";
import { validPublicationId } from "../identity.js";
import { byteRange } from "./range.js";

export async function readyPublication(env, id) {
  if (!env.DB || !env.MEDIA || !validPublicationId(id)) return null;
  return env.DB.prepare("SELECT * FROM publications WHERE id = ? AND status = 'ready'").bind(id).first();
}

export async function viewPublication(request, env, id) {
  const publication = await readyPublication(env, id);
  if (!publication) return notFound();
  const origin = new URL(request.url).origin;
  // Static Assets canonicalizes .html URLs with redirects. Request its clean
  // URL so template loading receives HTML rather than a redirect response.
  const asset = await env.ASSETS.fetch(new Request(`${origin}/player/published`));
  if (!asset.ok) throw new HttpError(503, "The video player is temporarily unavailable.");
  const values = { TITLE: publication.title, PUBLICATION_ID: id, CANONICAL_URL: `${origin}/player/${id}`,
    MEDIA_URL: `${origin}/media/${id}`, FORMAT: publication.format, CONTENT_TYPE: publication.content_type };
  const html = (await asset.text()).replace(/\{\{(TITLE|PUBLICATION_ID|CANONICAL_URL|MEDIA_URL|FORMAT|CONTENT_TYPE)\}\}/g,
    (_, name) => escapeHtml(values[name]));
  return new Response(request.method === "HEAD" ? null : html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "same-origin",
  } });
}

export async function readMedia(request, env, id) {
  const publication = await readyPublication(env, id);
  if (!publication) return notFound();
  let range;
  try { range = byteRange(request.headers.get("Range"), publication.bytes); }
  catch (error) {
    if (error.status !== 416) throw error;
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${publication.bytes}`, "Cache-Control": "no-store" } });
  }
  const object = request.method === "HEAD" ? await env.MEDIA.head(publication.object_key)
    : await env.MEDIA.get(publication.object_key, range ? { range } : undefined);
  if (!object) return notFound();
  const headers = new Headers({ "Content-Type": publication.content_type, "Accept-Ranges": "bytes",
    "Content-Length": String(range?.length ?? publication.bytes), "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "ETag": object.httpEtag });
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${publication.bytes}`);
  return new Response(request.method === "HEAD" ? null : object.body, { status: range ? 206 : 200, headers });
}
