import { HttpError } from "../http.js";
import { beginAttempt, discardAttempt, finishAttempt } from "./repository.js";
import { inspectUpload } from "./inspect-upload.js";
import { putExactBody, ExactUploadError } from "../storage/exact-upload.js";

async function storeExactBody(request, bucket, key, bytes, timeoutMs) {
  try {
    await putExactBody(request, bucket, key, bytes, { timeoutMs });
  } catch (error) {
    if (!(error instanceof ExactUploadError)) throw error;
    if (error.code === "missing")
      throw new HttpError(400, "An exported file is required.");
    if (error.code === "length")
      throw new HttpError(
        400,
        "The uploaded size differs from the prepared export.",
      );
    if (["conditional", "incomplete"].includes(error.code))
      throw new HttpError(400, "The uploaded file is incomplete.");
    throw new HttpError(
      400,
      "The upload was interrupted or its size changed. Please retry.",
    );
  }
}

export async function uploadPublication(request, env, config, publication) {
  if (publication.status === "ready") return publication;
  if (publication.status !== "pending" || publication.expires_at <= Date.now())
    throw new HttpError(
      410,
      "This upload expired or was removed. Start a new link.",
    );
  const type = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (type !== publication.content_type)
    throw new HttpError(415, "The file type differs from the prepared export.");
  const attempt = await beginAttempt(env.DB, publication, config);
  let committed = false;
  try {
    await storeExactBody(
      request,
      env.MEDIA,
      attempt.key,
      publication.bytes,
      config.uploadMs,
    );
    const verifiedType = await inspectUpload(
      env.MEDIA,
      attempt.key,
      publication,
    );
    committed = await finishAttempt(env.DB, publication, attempt, verifiedType);
    if (!committed)
      throw new HttpError(
        409,
        "This publication was cancelled before the upload finished.",
      );
    return {
      ...publication,
      status: "ready",
      object_key: attempt.key,
      content_type: verifiedType,
    };
  } finally {
    if (!committed) {
      // If the final write succeeded but its response was lost, do not remove
      // the object that the ready record now owns.
      const current = await env.DB.prepare(
        "SELECT object_key, status FROM publications WHERE id = ?",
      )
        .bind(publication.id)
        .first();
      if (current?.status !== "ready" || current.object_key !== attempt.key) {
        try {
          await discardAttempt(env.DB, env.MEDIA, publication.id, attempt);
        } catch {
          console.error(
            "Publication upload cleanup deferred",
            publication.id,
            attempt.id,
          );
        }
      }
    }
  }
}
