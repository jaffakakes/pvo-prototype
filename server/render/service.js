import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { renderScene, RenderInputError, validateRenderSource } from "./render-scene.js";

const MAX_REQUEST_BYTES = 2_000_000;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;

function parseStorageUrl(raw, origin = null) {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The render storage URL is invalid.");
  if (origin && url.origin !== origin)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "Render storage URLs must have the same origin.");
  return url;
}

async function readRequest(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES)
      throw new RenderInputError("INVALID_RENDER_SOURCE", "The render request is too large.");
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RenderInputError("INVALID_RENDER_SOURCE", "The render request is not valid JSON."); }
  if (!body || typeof body !== "object" || !Array.isArray(body.assets) || body.assets.length > 200)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The render assets are invalid.");
  if (typeof body.jobId !== "string" || !ASSET_ID.test(body.jobId))
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The render job ID is invalid.");
  const outputUrl = parseStorageUrl(body.outputUrl);
  const progressUrl = body.progressUrl == null ? null : parseStorageUrl(body.progressUrl, outputUrl.origin);
  const seen = new Set();
  const assets = body.assets.map(asset => {
    if (!asset || typeof asset.id !== "string" || !ASSET_ID.test(asset.id) || seen.has(asset.id))
      throw new RenderInputError("INVALID_RENDER_SOURCE", "A render asset ID is invalid or repeated.");
    seen.add(asset.id);
    return { id: asset.id, url: parseStorageUrl(asset.url, outputUrl.origin) };
  });
  return { source: body.source, assets, outputUrl, progressUrl, jobId: body.jobId };
}

function progressReporter(url, fetchImpl, signal) {
  if (!url) return () => {};
  let lastSent = 0;
  let lastFraction = -1;
  return fraction => {
    const now = Date.now();
    const progress = Math.min(1, Math.max(0, fraction));
    if (progress <= lastFraction || (progress < 1 && now - lastSent < 1000)) return;
    lastSent = now;
    lastFraction = progress;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    // Progress is advisory. A lost update must never cancel a good MP4 upload.
    void fetchImpl(url, {
      method: "POST", redirect: "error", signal: deadline,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fraction: progress }),
    }).catch(() => {});
  };
}

async function downloadAsset(asset, destination, fetchImpl, signal) {
  const response = await fetchImpl(asset.url, { redirect: "error", signal });
  if (!response.ok || !response.body)
    throw new Error(`Could not read render asset ${asset.id}: HTTP ${response.status}.`);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, next) {
      bytes += chunk.length;
      next(bytes > MAX_ASSET_BYTES ? new Error(`Render asset ${asset.id} exceeds the size limit.`) : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(destination), { signal });
  if (!bytes) throw new Error(`Render asset ${asset.id} is empty.`);
}

async function uploadResult(url, file, fetchImpl, signal) {
  const { size } = await stat(file);
  const response = await fetchImpl(url, {
    method: "PUT", redirect: "error", signal,
    headers: { "content-type": "video/mp4", "content-length": String(size) },
    body: createReadStream(file), duplex: "half",
  });
  if (!response.ok) throw new Error(`Could not store rendered video: HTTP ${response.status}.`);
  return size;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

/** Private HTTP endpoint reached only through the Worker Container binding. */
export function createRenderServer({ fetchImpl = fetch, render = renderScene, ffmpegPath = process.env.PVO_FFMPEG_PATH || "ffmpeg", ffprobePath = process.env.PVO_FFPROBE_PATH || "ffprobe" } = {}) {
  let busy = false;
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ready: true, busy });
      return;
    }
    if (request.method !== "POST" || request.url !== "/render") {
      sendJson(response, 404, { code: "NOT_FOUND" });
      return;
    }
    if (busy) {
      sendJson(response, 429, { code: "RENDER_BUSY", message: "The renderer is busy." });
      return;
    }
    busy = true;
    const controller = new AbortController();
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    let directory;
    let jobId = "unknown";
    let stage = "read request";
    try {
      const parsed = await readRequest(request);
      ({ jobId } = parsed);
      const { source, assets, outputUrl, progressUrl } = parsed;
      validateRenderSource(source, new Map(assets.map(asset => [asset.id, asset.url.href])));
      directory = await mkdtemp(path.join(tmpdir(), `restyle-job-${jobId}-`));
      const media = new Map();
      stage = "download assets";
      for (const asset of assets) {
        const file = path.join(directory, asset.id);
        await downloadAsset(asset, file, fetchImpl, controller.signal);
        media.set(asset.id, file);
      }
      stage = "render video";
      const result = await render({
        source, media, outputPath: path.join(directory, "result.mp4"), ffmpegPath, ffprobePath,
        signal: controller.signal, onProgress: progressReporter(progressUrl, fetchImpl, controller.signal),
      });
      stage = "upload result";
      const bytes = await uploadResult(outputUrl, result.path, fetchImpl, controller.signal);
      sendJson(response, 200, { duration: result.durationSeconds, bytes, contentType: result.contentType, width: result.width, height: result.height });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RenderInputError)
        sendJson(response, error.code === "UNSUPPORTED_RENDER_FEATURE" ? 422 : 400, { code: error.code, message: error.message });
      else {
        // Storage-transfer errors may contain signed URLs in their cause.
        console.error("Server render failed", { jobId, stage, name: error?.name ?? "Error", code: error?.code ?? null });
        sendJson(response, 500, { code: "RENDER_FAILED", message: "The video could not be rendered." });
      }
    } finally {
      busy = false;
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });
}
