import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  createLocalRenderJobs,
  publicJob,
} from "../../scripts/dev/render-jobs/jobs.mjs";
import { uploadSource } from "../../scripts/dev/render-jobs/transfers.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function responseRecorder() {
  return {
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

test("local rendering serializes jobs and cancellation releases queued and active files", async (t) => {
  const started = deferred();
  const calls = [];
  const jobs = await createLocalRenderJobs({
    async render({ source, signal }) {
      calls.push(source);
      started.resolve();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
  });
  t.after(() => jobs.close());
  const active = await jobs.create("owner", {
    source: "first",
    assets: new Map(),
  });
  const queued = await jobs.create("owner", {
    source: "second",
    assets: new Map(),
  });
  assert.equal(jobs.start(active), true);
  await started.promise;
  assert.equal(jobs.start(queued), true);
  assert.equal(queued.status, "queued");
  await jobs.cancel(queued);
  assert.equal(existsSync(queued.directory), false);
  await jobs.cancel(active);
  await jobs.close();
  assert.deepEqual(
    calls,
    ["first"],
    "Cancelled queued work must never enter FFmpeg",
  );
  assert.equal(active.controller.signal.aborted, true);
  assert.equal(jobs.get(active.id), undefined);
  assert.equal(existsSync(active.directory), false);
});

test("an incomplete local source can be retried, then the completed job exposes its result", async (t) => {
  const rendered = deferred();
  const jobs = await createLocalRenderJobs({
    async render({ media, outputPath, onProgress }) {
      assert.equal(await readFile(media.get("clip"), "utf8"), "source");
      onProgress(0.5);
      await writeFile(outputPath, "result");
      rendered.resolve();
    },
  });
  t.after(() => jobs.close());
  const job = await jobs.create("owner", {
    source: {},
    assets: new Map([
      [
        "clip",
        {
          bytes: 6,
          uploaded: false,
          uploading: false,
          contentType: "video/mp4",
        },
      ],
    ]),
  });
  assert.equal(jobs.start(job), false);
  for (const [bytes, status] of [
    ["bad", 422],
    ["source", 200],
  ]) {
    const request = Readable.from([Buffer.from(bytes)]);
    request.headers = { "content-length": "6" };
    const response = responseRecorder();
    await uploadSource(request, response, job, "clip", jobs.remove);
    assert.equal(response.status, status);
    assert.equal(job.activeUploads, 0);
    assert.equal(job.assets.get("clip").uploading, false);
    assert.equal(
      existsSync(join(job.directory, "sources", "clip")),
      status === 200,
    );
  }
  assert.equal(jobs.start(job), true);
  await rendered.promise;
  // close joins the execution queue before removing its private temporary files.
  await jobs.close();
  assert.deepEqual(publicJob(job), {
    id: job.id,
    status: "ready",
    progress: 1,
    resultUrl: `/api/renders/${job.id}/result`,
  });
  assert.equal(existsSync(job.directory), false);
});

test("loopback keeps its larger upload budget while sharing hosted source validation", async () => {
  const { validateJobInput } =
    await import("../../scripts/dev/render-jobs/input.mjs");
  const { renderInput } = await import("../../server/render-jobs/input.js");
  const source = {
    ratio: "9:16",
    quality: "1080p",
    muted: false,
    sound: 0,
    texts: [],
    components: [],
    audioClips: [],
    clips: [
      {
        id: 1,
        url: "clip",
        color: "#ffffff",
        srcDur: 2,
        in: 0,
        out: 2,
        speed: 1,
        zoom: 1,
        mirror: false,
        width: 1080,
        height: 1920,
        fit: "contain",
      },
    ],
  };
  const asset = {
    id: "clip",
    bytes: 51 * 1024 * 1024,
    contentType: "video/mp4",
  };
  assert.equal(
    validateJobInput({ source, assets: [asset] }).assets.get("clip").bytes,
    asset.bytes,
  );
  assert.throws(
    () => renderInput({ source, assets: [asset] }),
    (error) => error.status === 422,
  );
  const invalid = {
    source: { ...source, clips: [{ ...source.clips[0], speed: 0 }] },
    assets: [{ ...asset, bytes: 1 }],
  };
  assert.throws(() => validateJobInput(invalid), /outside its allowed range/i);
  assert.throws(
    () => renderInput(invalid),
    (error) => error.status === 422,
  );
});
