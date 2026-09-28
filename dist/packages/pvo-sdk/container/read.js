import { inputStartsWith, toBytes, textDecoder, mediaMimeType } from "./binary.js";
import { PVO_CONTAINER_MAGIC, MANIFEST_SUBTYPE } from "./constants.js";
import { readPvoProject } from "./project.js";
import { inspectMp4, isManifestBox, stripPvoBoxes } from "./mp4.js";
import { PVO_MANIFEST_LIMIT } from "../manifest/constants.js";
import { validatePvo } from "../manifest/validate.js";

/** Read a PVO file and return both its manifest and its plain-video fallback bytes. */
export async function readPvo(file) {
  if (await inputStartsWith(file, PVO_CONTAINER_MAGIC)) {
    const project = await readPvoProject(file);
    const firstClip = project.manifest.playback?.timelines
      ?.find((timeline) => timeline.id === project.manifest.playback?.initial_timeline)
      ?.clips?.[0];
    const mainAssetId = firstClip?.asset_id || project.manifest.media?.[0]?.asset_id || project.manifest.media?.[0]?.id;
    const mainAsset = project.assets.find((asset) => asset.id === mainAssetId) || project.assets[0];
    return { ...project, videoBlob: mainAsset.blob };
  }
  const bytes = await toBytes(file);
  const boxes = inspectMp4(bytes);
  const manifests = boxes.filter((box) => isManifestBox(bytes, box));
  if (!manifests.length) throw new Error("No PVO manifest was found in this MP4.");
  const box = manifests.at(-1);
  const jsonStart = box.payloadOffset + MANIFEST_SUBTYPE.length;
  const manifestLength = box.offset + box.size - jsonStart;
  if (manifestLength > PVO_MANIFEST_LIMIT) {
    throw new Error(`PVO manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(textDecoder.decode(bytes.subarray(jsonStart, box.offset + box.size)));
  } catch (error) {
    throw new Error(`The PVO manifest is not valid JSON: ${error.message}`);
  }
  const validation = validatePvo(manifest);
  const videoBytes = stripPvoBoxes(bytes, boxes);
  return {
    manifest,
    validation,
    videoBlob: new Blob([videoBytes], { type: mediaMimeType(file) }),
    fileName: file?.name || (mediaMimeType(file) === "video/quicktime" ? "video.pvo.mov" : "video.pvo.mp4"),
  };
}

/** Return null for a plain MP4 or MOV; throw only when a detected PVO is malformed. */
export async function tryReadPvo(file) {
  try {
    return await readPvo(file);
  } catch (error) {
    if (String(error?.message).includes("No PVO manifest") || String(error?.message).includes("No PVO package header")) return null;
    throw error;
  }
}
