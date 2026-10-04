import { claimRenderJob, failRenderJob, finishRenderJob, renderAssets, renderJob } from "./repository.js";
import { inspectSource } from "./storage.js";
import { internalUrl } from "./tokens.js";

const TRANSFER_MS = 15 * 60 * 1000;

async function processRenderJob(env, id) {
  const job = await claimRenderJob(env.DB, id);
  if (!job) return;
  try {
    const assets = await renderAssets(env.DB, id);
    const expires = Date.now() + TRANSFER_MS;
    const sourceUrls = await Promise.all(assets.map(async asset => {
      const object = await env.MEDIA.head(asset.object_key);
      if (!asset.uploaded_at || !object || object.size !== asset.bytes)
        throw new Error("A render source is missing or incomplete.");
      return { id: asset.id, url: await internalUrl(env.PUBLIC_ORIGIN, env.SESSION_SECRET,
        "GET", id, asset.id, asset.object_key, expires) };
    }));
    const outputUrl = await internalUrl(env.PUBLIC_ORIGIN, env.SESSION_SECRET,
      "PUT", id, "result", job.result_key, expires);
    const progressUrl = await internalUrl(env.PUBLIC_ORIGIN, env.SESSION_SECRET,
      "POST", id, "progress", job.result_key, expires);
    const container = env.RENDERER.get(env.RENDERER.idFromName("restyle-renderer"));
    const response = await container.fetch("http://container/render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: JSON.parse(job.source_json), assets: sourceUrls,
        outputUrl, progressUrl, jobId: id }),
    });
    if (!response.ok) throw new Error(`Renderer returned ${response.status}.`);
    const report = await response.json();
    const object = await env.MEDIA.head(job.result_key);
    if (!object || object.size < 1 || object.size !== report.bytes
      || report.contentType !== "video/mp4" || !await inspectSource(env.MEDIA, job.result_key))
      throw new Error("The rendered MP4 was not stored completely.");
    if (!await finishRenderJob(env.DB, id, job.result_key))
      await env.MEDIA.delete(job.result_key);
  } catch (error) {
    const current = await renderJob(env.DB, id);
    if (current?.status !== "cancelled") console.error("Render job failed", id, error?.name, error?.message);
    await env.MEDIA.delete(job.result_key);
    await failRenderJob(env.DB, id, job.result_key, "The server could not render this video. Please retry or use browser export.");
  }
}

export async function processRenderQueue(batch, env) {
  for (const message of batch.messages) {
    const id = message.body?.id;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{22}$/.test(id))
      await processRenderJob(env, id);
  }
}
