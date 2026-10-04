import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { renderScene, validateRenderSource } from "../../server/render/render-scene.js";

const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_SOURCES = 32;
const MAX_JOB_BYTES = 1024 * 1024 * 1024;
const JOB_LIFETIME_MS = 30 * 60 * 1000;
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const JOB_ID = /^[a-f0-9]{32}$/;
const fullFfmpeg = ["/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg"]
  .find(candidate => existsSync(candidate));
const ffmpegPath = process.env.PVO_FFMPEG_PATH || fullFfmpeg || "ffmpeg";
const ffprobePath = process.env.PVO_FFPROBE_PATH || (ffmpegPath.includes("/") ? join(dirname(ffmpegPath), "ffprobe") : "ffprobe");

function json(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function failure(response, status, message) {
  json(response, status, { error: message });
}

async function readJson(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 256 * 1024) throw new Error("The render description is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateJobInput(body) {
  if (!body || typeof body !== "object" || !body.source || !Array.isArray(body.assets))
    throw new Error("The render description is incomplete.");
  const source = body.source;
  if (!(["720p", "1080p", "4K"].includes(source.quality)) || !["9:16", "1:1", "4:5", "16:9"].includes(source.ratio)
    || !Array.isArray(source.clips) || !Array.isArray(source.audioClips ?? []) || !Array.isArray(source.texts ?? [])
    || !Array.isArray(source.components ?? []))
    throw new Error("The export settings or scene are invalid.");
  if (body.assets.length > MAX_SOURCES) throw new Error("This scene has too many source files.");
  validateRenderSource(source);
  const assets = new Map();
  let totalBytes = 0;
  for (const asset of body.assets) {
    if (!asset || typeof asset.id !== "string" || !ASSET_ID.test(asset.id) || assets.has(asset.id)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_SOURCE_BYTES
      || typeof asset.contentType !== "string" || asset.contentType.length > 120)
      throw new Error("A source file description is invalid.");
    totalBytes += asset.bytes;
    assets.set(asset.id, { bytes: asset.bytes, uploaded: false, uploading: false, contentType: asset.contentType });
  }
  if (totalBytes > MAX_JOB_BYTES) throw new Error("The source files exceed the render size limit.");
  const references = [...source.clips, ...(source.audioClips ?? [])].flatMap(clip => clip.url ? [clip.url] : []);
  if (references.some(id => !assets.has(id)) || new Set(references).size !== assets.size)
    throw new Error("The scene and source files do not match.");
  return { source, assets };
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === "ready" ? { resultUrl: `/api/renders/${job.id}/result` } : {}),
  };
}

/** A loopback-only FFmpeg adapter using the local Google account session. */
export async function createLocalRenderApi({ userFor } = {}) {
  if (typeof userFor !== "function") throw new Error("Local rendering requires account session lookup.");
  const root = await mkdtemp(join(tmpdir(), "restyle-render-jobs-"));
  const jobs = new Map();
  let queue = Promise.resolve();

  async function removeJob(job) {
    jobs.delete(job.id);
    await rm(job.directory, { recursive: true, force: true });
  }

  async function prune() {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (now - job.createdAt <= JOB_LIFETIME_MS) continue;
      job.controller.abort();
      if (job.status !== "rendering") await removeJob(job);
    }
  }

  const cleanup = setInterval(() => { void prune(); }, 60_000);
  cleanup.unref();

  async function run(job) {
    if (job.status !== "queued") return;
    job.status = "rendering";
    try {
      const media = new Map([...job.assets.keys()].map(id => [id, join(job.directory, "sources", id)]));
      await renderScene({
        source: job.source,
        media,
        outputPath: join(job.directory, "result.mp4"),
        ffmpegPath,
        ffprobePath,
        signal: job.controller.signal,
        onProgress: value => { job.progress = Math.max(0, Math.min(1, value)); },
      });
      if (job.status !== "cancelled") {
        job.status = "ready";
        job.progress = 1;
      }
    } catch (error) {
      if (job.status !== "cancelled") {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "The render failed.";
        console.error("Local server render failed:", error);
      }
    } finally {
      if (job.status === "cancelled") await removeJob(job);
    }
  }

  async function handle(request, response, pathname, origin) {
    if (!pathname.startsWith("/api/renders")) return false;
    if (pathname === "/api/renders" && request.method === "GET")
      return json(response, 200, { available: true, maxSourceBytes: MAX_SOURCE_BYTES, maxSources: MAX_SOURCES,
        formats: ["video"], qualities: ["720p", "1080p", "4K"] });
    if (request.method !== "GET" && request.headers.origin !== origin)
      return failure(response, 403, "This request must come from the editor.");
    const user = await userFor(request);
    if (!user?.id) return failure(response, 401, "Sign in to render this export.");
    if (pathname === "/api/renders" && request.method === "POST") {
      let input;
      try { input = validateJobInput(await readJson(request)); }
      catch (error) { return failure(response, 422, error instanceof Error ? error.message : "The render description is invalid."); }
      const id = randomBytes(16).toString("hex");
      const directory = join(root, id);
      await mkdir(join(directory, "sources"), { recursive: true });
      const job = { id, directory, owner: user.id, createdAt: Date.now(), ...input,
        status: "uploading", progress: 0, controller: new AbortController(), error: null, activeUploads: 0 };
      jobs.set(id, job);
      return json(response, 201, publicJob(job));
    }
    const match = /^\/api\/renders\/([^/]+)(?:\/(sources\/([^/]+)|start|result))?$/.exec(pathname);
    if (!match || !JOB_ID.test(match[1])) return failure(response, 404, "This render is unavailable.");
    const job = jobs.get(match[1]);
    if (!job || job.owner !== user.id) return failure(response, 404, "This render is unavailable.");
    if (!match[2] && request.method === "GET") return json(response, 200, publicJob(job));
    if (match[2] === "result" && request.method === "GET") {
      if (job.status !== "ready") return failure(response, 409, "The render is not ready.");
      const path = join(job.directory, "result.mp4");
      const { size } = await stat(path);
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="restyle-video.mp4"',
        "Content-Length": size,
        "Cache-Control": "no-store",
      });
      createReadStream(path).pipe(response);
      return;
    }
    if (match[2] === "start" && request.method === "POST") {
      if (job.status !== "uploading" || [...job.assets.values()].some(asset => !asset.uploaded))
        return failure(response, 409, "Upload all source files before rendering.");
      job.status = "queued";
      queue = queue.then(() => run(job)).catch(error => console.error("Local render queue failed:", error));
      return json(response, 202, publicJob(job));
    }
    if (match[2]?.startsWith("sources/") && request.method === "PUT") {
      const asset = job.assets.get(match[3]);
      if (!asset || job.status !== "uploading" || asset.uploading || asset.uploaded)
        return failure(response, 409, "This source cannot be uploaded now.");
      const declared = Number(request.headers["content-length"]);
      if (declared !== asset.bytes) return failure(response, 422, "Source file size changed during upload.");
      asset.uploading = true;
      job.activeUploads += 1;
      const path = join(job.directory, "sources", match[3]);
      let received = 0;
      try {
        await pipeline(request, new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            callback(received <= asset.bytes ? null : new Error("Source file exceeded its declared size."), chunk);
          },
        }), createWriteStream(path, { flags: "wx" }), { signal: job.controller.signal });
        if (received !== asset.bytes) throw new Error("Source file upload was incomplete.");
        asset.uploaded = true;
        return json(response, 200, { uploaded: true });
      } catch (error) {
        await rm(path, { force: true });
        return failure(response, 422, error instanceof Error ? error.message : "Source upload failed.");
      } finally {
        asset.uploading = false;
        job.activeUploads -= 1;
        if (job.status === "cancelled" && job.activeUploads === 0) await removeJob(job);
      }
    }
    if (!match[2] && request.method === "DELETE") {
      const previousStatus = job.status;
      job.status = "cancelled";
      job.controller.abort();
      if (previousStatus !== "rendering" && job.activeUploads === 0) await removeJob(job);
      return json(response, 200, { cancelled: true });
    }
    return failure(response, 405, "This render operation is not supported.");
  }

  async function close() {
    clearInterval(cleanup);
    for (const job of jobs.values()) job.controller.abort();
    await queue;
    await rm(root, { recursive: true, force: true });
  }

  return { handle, close };
}
