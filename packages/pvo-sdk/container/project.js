import { validatePvo } from "../manifest/validate.js";
import { textEncoder, inputSize, mediaMimeType, readInputRange, inputSliceBlob } from "./binary.js";
import { inspectPvoProject } from "./inspect.js";
import { PVO_MANIFEST_LIMIT } from "../manifest/constants.js";
import { PVO_CONTAINER_VERSION, PVO_CONTAINER_HEADER_LIMIT, PVO_CONTAINER_PREFIX_SIZE, PVO_CONTAINER_MAGIC, PVO_CONTAINER_MIME } from "./constants.js";

/** Pack a self-contained .pvo file with a manifest and every referenced media asset. */
export async function packPvoProject({ manifest, assets }) {
  const result = validatePvo(manifest);
  if (!result.valid) {
    throw new Error(`Invalid PVO manifest:\n${result.errors.join("\n")}`);
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("A PVO project needs at least one media asset.");
  }
  const manifestBytes = textEncoder.encode(JSON.stringify(manifest));
  if (manifestBytes.length > PVO_MANIFEST_LIMIT) {
    throw new Error(`Manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  }

  const ids = new Set();
  let offset = 0;
  const prepared = assets.map((asset, index) => {
    const id = String(asset?.id || "").trim();
    if (!id) throw new Error(`assets[${index}].id is required.`);
    if (ids.has(id)) throw new Error(`Asset id "${id}" is duplicated.`);
    ids.add(id);
    const source = asset.file ?? asset.blob ?? asset.data;
    const length = inputSize(source);
    if (!length) throw new Error(`Asset "${id}" is empty.`);
    const entry = {
      id,
      name: String(asset.name || source?.name || id),
      type: String(asset.type || source?.type || mediaMimeType(source)),
      offset,
      length,
    };
    offset += length;
    return { entry, source };
  });

  for (const media of manifest.media || []) {
    const assetId = media?.asset_id || media?.id;
    if (assetId && !ids.has(assetId)) throw new Error(`Manifest media "${assetId}" is not included in the PVO package.`);
  }
  if (manifest.poster && !ids.has(manifest.poster.asset_id))
    throw new Error(`Manifest poster "${manifest.poster.asset_id}" is not included in the PVO package.`);
  const poster = manifest.poster && prepared.find(({ entry }) => entry.id === manifest.poster.asset_id)?.entry;
  if (poster && (poster.type !== "image/webp" || poster.length > 5 * 1024 * 1024))
    throw new Error("The PVO poster must be a WebP image under 5 MiB.");

  const headerBytes = textEncoder.encode(JSON.stringify({
    format: "pvo",
    version: PVO_CONTAINER_VERSION,
    manifest,
    assets: prepared.map(({ entry }) => entry),
  }));
  if (headerBytes.length > PVO_CONTAINER_HEADER_LIMIT) {
    throw new Error(`PVO package header exceeds ${PVO_CONTAINER_HEADER_LIMIT / 1024 / 1024} MB.`);
  }
  const prefix = new Uint8Array(PVO_CONTAINER_PREFIX_SIZE);
  prefix.set(PVO_CONTAINER_MAGIC, 0);
  new DataView(prefix.buffer).setUint32(PVO_CONTAINER_MAGIC.length, headerBytes.length, false);
  return new Blob([prefix, headerBytes, ...prepared.map(({ source }) => source)], { type: PVO_CONTAINER_MIME });
}

/** Read a self-contained .pvo package without copying its media payloads when Blob slicing is available. */
export async function readPvoProject(file) {
  const inspected = await inspectPvoProject({ size: inputSize(file), readRange: (start, end) => readInputRange(file, start, end) });
  const assets = await Promise.all(inspected.assets.map(async asset => ({
    id: asset.id, name: asset.name, type: asset.type, size: asset.length,
    blob: await inputSliceBlob(file, inspected.payloadStart + asset.offset,
      inspected.payloadStart + asset.offset + asset.length, asset.type),
  })));
  return {
    manifest: inspected.manifest,
    validation: inspected.validation,
    assets,
    container: true,
    fileName: file?.name || "video.pvo",
  };
}
