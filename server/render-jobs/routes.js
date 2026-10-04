import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { validPublicationId } from "../identity.js";
import { getAccountSession } from "../auth/sessions.js";
import { MAX_SOURCE_BYTES, MAX_SOURCES, renderInput, validAssetId } from "./input.js";
import { createRenderJob, ownedRenderJob, renderAssets, markAssetUploaded,
  beginAssetUpload, releaseAssetUpload, queueRenderJob, cancelRenderJob, publicRenderJob, renderJob } from "./repository.js";
import { updateRenderProgress } from "./repository.js";
import { inspectSource, putExact, resultLength } from "./storage.js";
import { verifyInternalUrl } from "./tokens.js";

function unavailable() {
  throw new HttpError(503, "Server rendering is not available here yet.");
}

async function sourceUpload(request, env, job, assetId) {
  if (job.status !== "uploading" || job.expires_at <= Date.now())
    throw new HttpError(409, "This render is no longer accepting source files.");
  const asset = (await renderAssets(env.DB, job.id)).find(item => item.id === assetId);
  if (!asset) throw new HttpError(404, "This render source is unavailable.");
  if (asset.uploaded_at) return json({ uploaded: true });
  const type = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== asset.content_type) throw new HttpError(415, "This source type differs from the render request.");
  const attempt = await beginAssetUpload(env.DB, job.id, asset.id);
  try {
    // A previous request may have ended after R2 accepted bytes but before D1
    // recorded success. The new lease owns this key, so remove that orphan.
    await env.MEDIA.delete(asset.object_key);
    await putExact(request, env.MEDIA, asset.object_key, asset.bytes, asset.content_type);
    if (!await inspectSource(env.MEDIA, asset.object_key))
      throw new HttpError(415, "This source is not a supported media file.");
    if (!await markAssetUploaded(env.DB, job.id, asset.id, attempt))
      throw new HttpError(409, "This render was cancelled while the source uploaded.");
    return json({ uploaded: true });
  } catch (error) {
    await env.MEDIA.delete(asset.object_key);
    throw error;
  } finally {
    await releaseAssetUpload(env.DB, job.id, asset.id, attempt);
  }
}

async function startRender(env, job, ownerId) {
  if (job.status !== "uploading") throw new HttpError(409, "This render has already started or ended.");
  if (!await queueRenderJob(env.DB, job.id, ownerId))
    throw new HttpError(409, "Finish uploading every source before starting this render.");
  try {
    await env.RENDER_QUEUE.send({ id: job.id });
  } catch {
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?
      WHERE id = ? AND status = 'queued'`).bind("The renderer could not start. Please try again.", job.id).run();
    throw new HttpError(503, "The renderer could not start. Please try again.");
  }
  return json({ id: job.id, status: "queued", progress: 0 }, 202);
}

async function resultDownload(env, job) {
  if (job.status !== "ready" || !job.result_key)
    throw new HttpError(409, "This video is not ready to download yet.");
  const object = await env.MEDIA.get(job.result_key);
  if (!object) throw new HttpError(410, "This rendered video has expired.");
  return new Response(object.body, { headers: {
    "Content-Type": "video/mp4", "Content-Length": String(object.size),
    "Content-Disposition": 'attachment; filename="restyle-video.mp4"', "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

async function cancelAndClean(env, job, ownerId) {
  await cancelRenderJob(env.DB, job.id, ownerId);
  const assets = await renderAssets(env.DB, job.id);
  const keys = assets.map(asset => asset.object_key);
  if (job.result_key) keys.push(job.result_key);
  await Promise.all(keys.map(key => env.MEDIA.delete(key)));
  return json({ cancelled: true });
}

async function internalTransfer(request, env, url) {
  const source = /^\/api\/renders\/internal\/([^/]+)\/sources\/([^/]+)$/.exec(url.pathname);
  const result = /^\/api\/renders\/internal\/([^/]+)\/result$/.exec(url.pathname);
  const progress = /^\/api\/renders\/internal\/([^/]+)\/progress$/.exec(url.pathname);
  const id = source?.[1] || result?.[1] || progress?.[1];
  if (!id || !validPublicationId(id)) throw new HttpError(404, "This render transfer is unavailable.");
  const job = await renderJob(env.DB, id);
  if (!job || job.status !== "rendering" || job.expires_at <= Date.now())
    throw new HttpError(404, "This render transfer is unavailable.");
  if (source) {
    if (request.method !== "GET" || !validAssetId(source[2])) throw new HttpError(405, "This transfer is not supported.");
    const asset = (await renderAssets(env.DB, id)).find(item => item.id === source[2]);
    if (!asset?.uploaded_at) throw new HttpError(404, "This render source is unavailable.");
    await verifyInternalUrl(url, env.SESSION_SECRET, "GET", id, asset.id, asset.object_key);
    const object = await env.MEDIA.get(asset.object_key);
    if (!object) throw new HttpError(410, "This render source has expired.");
    return new Response(object.body, { headers: { "Content-Type": asset.content_type,
      "Content-Length": String(object.size), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (progress) {
    if (request.method !== "POST") throw new HttpError(405, "This transfer is not supported.");
    await verifyInternalUrl(url, env.SESSION_SECRET, "POST", id, "progress", job.result_key);
    const body = await readJson(request, 128);
    if (typeof body?.fraction !== "number" || !Number.isFinite(body.fraction)
      || body.fraction < 0 || body.fraction > 1)
      throw new HttpError(400, "The render progress is invalid.");
    await updateRenderProgress(env.DB, id, job.result_key, body.fraction);
    return json({ updated: true });
  }
  if (request.method !== "PUT") throw new HttpError(405, "This transfer is not supported.");
  await verifyInternalUrl(url, env.SESSION_SECRET, "PUT", id, "result", job.result_key);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "video/mp4")
    throw new HttpError(415, "The rendered video must be MP4.");
  const bytes = resultLength(request);
  await putExact(request, env.MEDIA, job.result_key, bytes, "video/mp4");
  const stillActive = await renderJob(env.DB, id);
  if (stillActive?.status !== "rendering" || stillActive.result_key !== job.result_key) {
    await env.MEDIA.delete(job.result_key);
    throw new HttpError(409, "This render was cancelled while the video uploaded.");
  }
  return json({ uploaded: true, bytes });
}

export async function renderRoute(request, env, config) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/renders/internal/")) {
    if (env.RENDERING_ENABLED !== "true" || !env.DB || !env.MEDIA || !env.SESSION_SECRET) unavailable();
    return internalTransfer(request, env, url);
  }
  if (url.pathname === "/api/renders" && request.method === "GET")
    return json({ available: config.renderAvailable, maxSourceBytes: MAX_SOURCE_BYTES,
      maxSources: MAX_SOURCES, formats: ["video"], qualities: ["720p", "1080p", "4K"] });
  if (!config.renderAvailable) unavailable();
  if (request.method !== "GET") checkOrigin(request, config.origin);
  const owner = await getAccountSession(request, env);
  if (!owner) throw new HttpError(401, "Sign in to render this export.");
  if (url.pathname === "/api/renders") {
    if (request.method !== "POST") throw new HttpError(405, "This render operation is not supported.");
    const input = renderInput(await readJson(request, 128 * 1024));
    return json(await createRenderJob(env.DB, owner.id, input), 201);
  }
  const match = /^\/api\/renders\/([^/]+)(?:\/(sources\/([^/]+)|start|result))?$/.exec(url.pathname);
  if (!match || !validPublicationId(match[1])) throw new HttpError(404, "This render is unavailable.");
  const job = await ownedRenderJob(env.DB, match[1], owner.id);
  if (match[2]?.startsWith("sources/") && request.method === "PUT" && validAssetId(match[3]))
    return sourceUpload(request, env, job, match[3]);
  if (match[2] === "start" && request.method === "POST") return startRender(env, job, owner.id);
  if (match[2] === "result" && request.method === "GET") return resultDownload(env, job);
  if (!match[2] && request.method === "GET") return json(publicRenderJob(job));
  if (!match[2] && request.method === "DELETE") return cancelAndClean(env, job, owner.id);
  throw new HttpError(405, "This render operation is not supported.");
}
