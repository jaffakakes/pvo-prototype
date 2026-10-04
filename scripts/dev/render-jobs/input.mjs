import { validAssetId } from "../../../server/render-jobs/input.js";
import { validateRenderSource } from "../../../server/render/source.js";

// Loopback FFmpeg accepts larger scenes than the hosted renderer.
export const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
export const MAX_SOURCES = 32;
const MAX_JOB_BYTES = 1024 * 1024 * 1024;

export async function readRenderJson(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 256 * 1024)
      throw new Error("The render description is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function validateJobInput(body) {
  if (
    !body ||
    typeof body !== "object" ||
    !body.source ||
    !Array.isArray(body.assets)
  )
    throw new Error("The render description is incomplete.");
  const source = body.source;
  if (
    !["720p", "1080p", "4K"].includes(source.quality) ||
    !["9:16", "1:1", "4:5", "16:9"].includes(source.ratio) ||
    !Array.isArray(source.clips) ||
    !Array.isArray(source.audioClips ?? []) ||
    !Array.isArray(source.texts ?? []) ||
    !Array.isArray(source.components ?? [])
  )
    throw new Error("The export settings or scene are invalid.");
  if (body.assets.length > MAX_SOURCES)
    throw new Error("This scene has too many source files.");
  validateRenderSource(source);
  const assets = new Map();
  let totalBytes = 0;
  for (const asset of body.assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      !validAssetId(asset.id) ||
      assets.has(asset.id) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > MAX_SOURCE_BYTES ||
      typeof asset.contentType !== "string" ||
      asset.contentType.length > 120
    )
      throw new Error("A source file description is invalid.");
    totalBytes += asset.bytes;
    assets.set(asset.id, {
      bytes: asset.bytes,
      uploaded: false,
      uploading: false,
      contentType: asset.contentType,
    });
  }
  if (totalBytes > MAX_JOB_BYTES)
    throw new Error("The source files exceed the render size limit.");
  const references = [...source.clips, ...(source.audioClips ?? [])].flatMap(
    (clip) => (clip.url ? [clip.url] : []),
  );
  if (
    references.some((id) => !assets.has(id)) ||
    new Set(references).size !== assets.size
  )
    throw new Error("The scene and source files do not match.");
  return { source, assets };
}
