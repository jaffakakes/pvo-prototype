import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { failure, json } from "../http.mjs";

export async function downloadResult(response, job) {
  if (job.status !== "ready")
    return failure(response, 409, "The render is not ready.");
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

export async function uploadSource(request, response, job, assetId, removeJob) {
  const asset = job.assets.get(assetId);
  if (!asset || job.status !== "uploading" || asset.uploading || asset.uploaded)
    return failure(response, 409, "This source cannot be uploaded now.");
  const declared = Number(request.headers["content-length"]);
  if (declared !== asset.bytes)
    return failure(response, 422, "Source file size changed during upload.");
  asset.uploading = true;
  job.activeUploads += 1;
  const path = join(job.directory, "sources", assetId);
  let received = 0;
  try {
    await pipeline(
      request,
      new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          callback(
            received <= asset.bytes
              ? null
              : new Error("Source file exceeded its declared size."),
            chunk,
          );
        },
      }),
      createWriteStream(path, { flags: "wx" }),
      { signal: job.controller.signal },
    );
    if (received !== asset.bytes)
      throw new Error("Source file upload was incomplete.");
    asset.uploaded = true;
    return json(response, 200, { uploaded: true });
  } catch (error) {
    await rm(path, { force: true });
    return failure(
      response,
      422,
      error instanceof Error ? error.message : "Source upload failed.",
    );
  } finally {
    asset.uploading = false;
    job.activeUploads -= 1;
    if (job.status === "cancelled" && job.activeUploads === 0)
      await removeJob(job);
  }
}
