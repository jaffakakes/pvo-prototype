import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderScene } from "../../../server/render/render-scene.js";

const JOB_LIFETIME_MS = 30 * 60 * 1000;
const fullFfmpeg = [
  "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
  "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
].find((candidate) => existsSync(candidate));
const ffmpegPath = process.env.PVO_FFMPEG_PATH || fullFfmpeg || "ffmpeg";
const ffprobePath =
  process.env.PVO_FFPROBE_PATH ||
  (ffmpegPath.includes("/") ? join(dirname(ffmpegPath), "ffprobe") : "ffprobe");

export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === "ready"
      ? { resultUrl: `/api/renders/${job.id}/result` }
      : {}),
  };
}

/** Own temporary render files, execution order and cancellation until close. */
export async function createLocalRenderJobs({ render = renderScene } = {}) {
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

  const cleanup = setInterval(() => {
    void prune();
  }, 60_000);
  cleanup.unref();

  async function run(job) {
    if (job.status !== "queued") return;
    job.status = "rendering";
    try {
      const media = new Map(
        [...job.assets.keys()].map((id) => [
          id,
          join(job.directory, "sources", id),
        ]),
      );
      await render({
        source: job.source,
        media,
        outputPath: join(job.directory, "result.mp4"),
        ffmpegPath,
        ffprobePath,
        signal: job.controller.signal,
        onProgress: (value) => {
          job.progress = Math.max(0, Math.min(1, value));
        },
      });
      if (job.status !== "cancelled") {
        job.status = "ready";
        job.progress = 1;
      }
    } catch (error) {
      if (job.status !== "cancelled") {
        job.status = "failed";
        job.error =
          error instanceof Error ? error.message : "The render failed.";
        console.error("Local server render failed:", error);
      }
    } finally {
      if (job.status === "cancelled") await removeJob(job);
    }
  }

  async function create(owner, input) {
    const id = randomBytes(16).toString("hex");
    const directory = join(root, id);
    await mkdir(join(directory, "sources"), { recursive: true });
    const job = {
      id,
      directory,
      owner,
      createdAt: Date.now(),
      ...input,
      status: "uploading",
      progress: 0,
      controller: new AbortController(),
      error: null,
      activeUploads: 0,
    };
    jobs.set(id, job);
    return job;
  }

  function start(job) {
    if (
      job.status !== "uploading" ||
      [...job.assets.values()].some((asset) => !asset.uploaded)
    )
      return false;
    job.status = "queued";
    queue = queue
      .then(() => run(job))
      .catch((error) => console.error("Local render queue failed:", error));
    return true;
  }

  async function cancel(job) {
    const previousStatus = job.status;
    job.status = "cancelled";
    job.controller.abort();
    // An active render or upload releases its files in its own finally block.
    if (previousStatus !== "rendering" && job.activeUploads === 0)
      await removeJob(job);
  }

  async function close() {
    clearInterval(cleanup);
    for (const job of jobs.values()) job.controller.abort();
    await queue;
    await rm(root, { recursive: true, force: true });
  }

  return {
    get: (id) => jobs.get(id),
    create,
    start,
    cancel,
    remove: removeJob,
    close,
  };
}
