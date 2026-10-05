import { inspectPvoProject } from "../../packages/pvo-sdk/index.js";
import { HttpError } from "../http.js";
import { inspectVideo } from "./inspect-video.js";
import { isPosterImage } from "./poster.js";

export function r2Source(bucket, key, size) {
  return {
    size,
    async readRange(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > size || end <= start
        || end - start > 262144)
        throw new HttpError(415, "The export has an invalid or oversized header.");
      const object = await bucket.get(key, { range: { offset: start, length: end - start } });
      if (!object?.body) throw new HttpError(503, "The upload could not be checked. Please retry.");
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}

export async function inspectUpload(bucket, key, publication) {
  const source = r2Source(bucket, key, publication.bytes);
  try {
    if (publication.format === "video") return await inspectVideo(source, publication.content_type);
    const result = await inspectPvoProject(source, { maxHeaderBytes: 262144 });
    if (!result.validation.valid || !result.manifest?.playback?.timelines?.length || result.assets.length > 512)
      throw new Error(result.validation.errors[0] || "A playable PVO export is required.");
    if (result.manifest.poster) {
      const poster = result.assets.find(asset => asset.id === result.manifest.poster.asset_id);
      if (!poster || poster.length < 12 || !isPosterImage(await source.readRange(
        result.payloadStart + poster.offset, result.payloadStart + poster.offset + 12), result.manifest.poster.type))
        throw new Error("The PVO poster does not match its image type.");
    }
    return "application/vnd.pvo";
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(415, "This PVO file is invalid or exceeds the online header limit.");
  }
}
