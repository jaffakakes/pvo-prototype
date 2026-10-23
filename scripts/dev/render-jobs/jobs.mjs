import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderScene } from "../../../server/render/render-scene.js";
import { adjacentFfprobe } from "./executables.mjs";
import { createFileOwnership } from "./ownership.mjs";

const JOB_LIFETIME_MS = 30 * 60 * 1000;
const fullFfmpeg = [
  "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
  "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
].find((candidate) => existsSync(candidate));
const ffmpegPath = process.env.PVO_FFMPEG_PATH || fullFfmpeg || "ffmpeg";
const ffprobePath = adjacentFfprobe(ffmpegPath, process.env.PVO_FFPROBE_PATH);

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
export async function createLocalRenderJobs({
  render = renderScene,
  now = Date.now,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "restyle-render-jobs-"));
  const jobs = new Map();
  let queue = Promise.resolve();
  let closing;
  const creations = createFileOwnership();

  async function removeJob(job) {
    return (job.removal ??= (async () => {
      await job.ownership.settled();
      await rm(job.directory, { recursive: true, force: true });
      jobs.delete(job.id);
    })());
  }

  async function prune() {
    const time = now();
    for (const job of jobs.values()) {
      if (time - job.createdAt <= JOB_LIFETIME_MS) continue;
      await cancel(job);
    }
  }

  const cleanup = setInterval(() => {
    void prune().catch((error) =>
      console.error("Render expiry cleanup failed:", error?.name),
    );
  }, 60_000);
  cleanup.unref();

  async function run(job) {
    if (job.status !== "queued") return;
    const release = job.ownership.acquire("render");
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
      release();
      if (job.status === "cancelled") await removeJob(job);
    }
  }

  async function create(owner, input) {
    if (closing) throw new Error("Local rendering is closing.");
    const release = creations.acquire("create");
    const id = randomBytes(16).toString("hex");
    const directory = join(root, id);
    try {
      await mkdir(join(directory, "sources"), { recursive: true });
      if (closing) {
        await rm(directory, { recursive: true, force: true });
        throw new Error("Local rendering is closing.");
      }
      const ownership = createFileOwnership();
      const job = {
        id,
        directory,
        owner,
        createdAt: now(),
        ...input,
        status: "uploading",
        progress: 0,
        controller: new AbortController(),
        error: null,
        ownership,
        get activeUploads() {
          return ownership.count("upload");
        },
      };
      jobs.set(id, job);
      return job;
    } finally {
      release();
    }
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
    job.status = "cancelled";
    job.controller.abort();
    await removeJob(job);
  }

  function close() {
    return (closing ??= (async () => {
      clearInterval(cleanup);
      await creations.settled();
      await Promise.all([...jobs.values()].map(cancel));
      await queue;
      await rm(root, { recursive: true, force: true });
    })());
  }

  return {
    get: (id) => jobs.get(id),
    create,
    start,
    cancel,
    prune,
    remove: removeJob,
    close,
  };
}
