import { HttpError, json, readJson } from "../http.js";
import { validPublicationId } from "../identity.js";
import { validAssetId } from "./input.js";
import { renderJob, renderAssets, updateRenderProgress } from "./repository.js";
import { putExact, resultLength } from "./storage.js";
import { verifyInternalUrl } from "./tokens.js";

/** Signed transfers bind every request to the active render attempt and object key. */
export async function internalTransfer(request, env, url) {
  const source = /^\/api\/renders\/internal\/([^/]+)\/sources\/([^/]+)$/.exec(
    url.pathname,
  );
  const result = /^\/api\/renders\/internal\/([^/]+)\/result$/.exec(
    url.pathname,
  );
  const progress = /^\/api\/renders\/internal\/([^/]+)\/progress$/.exec(
    url.pathname,
  );
  const id = source?.[1] || result?.[1] || progress?.[1];
  if (!id || !validPublicationId(id))
    throw new HttpError(404, "This render transfer is unavailable.");
  const job = await renderJob(env.DB, id);
  if (!job || job.status !== "rendering" || job.expires_at <= Date.now())
    throw new HttpError(404, "This render transfer is unavailable.");
  if (source) {
    if (request.method !== "GET" || !validAssetId(source[2]))
      throw new HttpError(405, "This transfer is not supported.");
    const asset = (await renderAssets(env.DB, id)).find(
      (item) => item.id === source[2],
    );
    if (!asset?.uploaded_at)
      throw new HttpError(404, "This render source is unavailable.");
    await verifyInternalUrl(
      url,
      env.SESSION_SECRET,
      "GET",
      id,
      asset.id,
      asset.object_key,
    );
    const object = await env.MEDIA.get(asset.object_key);
    if (!object) throw new HttpError(410, "This render source has expired.");
    return new Response(object.body, {
      headers: {
        "Content-Type": asset.content_type,
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (progress) {
    if (request.method !== "POST")
      throw new HttpError(405, "This transfer is not supported.");
    await verifyInternalUrl(
      url,
      env.SESSION_SECRET,
      "POST",
      id,
      "progress",
      job.result_key,
    );
    const body = await readJson(request, 128);
    if (
      typeof body?.fraction !== "number" ||
      !Number.isFinite(body.fraction) ||
      body.fraction < 0 ||
      body.fraction > 1
    )
      throw new HttpError(400, "The render progress is invalid.");
    await updateRenderProgress(env.DB, id, job.result_key, body.fraction);
    return json({ updated: true });
  }
  if (request.method !== "PUT")
    throw new HttpError(405, "This transfer is not supported.");
  await verifyInternalUrl(
    url,
    env.SESSION_SECRET,
    "PUT",
    id,
    "result",
    job.result_key,
  );
  if (
    request.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "video/mp4"
  )
    throw new HttpError(415, "The rendered video must be MP4.");
  const bytes = resultLength(request);
  await putExact(request, env.MEDIA, job.result_key, bytes, "video/mp4");
  const stillActive = await renderJob(env.DB, id);
  if (
    stillActive?.status !== "rendering" ||
    stillActive.result_key !== job.result_key
  ) {
    await env.MEDIA.delete(job.result_key);
    throw new HttpError(
      409,
      "This render was cancelled while the video uploaded.",
    );
  }
  return json({ uploaded: true, bytes });
}
