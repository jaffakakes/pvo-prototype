import { validatePvo } from "../manifest/validate.js";
import { PVO_MANIFEST_LIMIT } from "../manifest/constants.js";
import { textDecoder, textEncoder, bytesEqual } from "./binary.js";
import {
  PVO_CONTAINER_MAGIC, PVO_CONTAINER_PREFIX_SIZE, PVO_CONTAINER_HEADER_LIMIT, PVO_CONTAINER_VERSION,
} from "./constants.js";

/** Inspect package metadata through bounded reads, without downloading media. */
export async function inspectPvoProject({ size, readRange }, { maxHeaderBytes = PVO_CONTAINER_HEADER_LIMIT } = {}) {
  if (!Number.isSafeInteger(size) || size < PVO_CONTAINER_PREFIX_SIZE)
    throw new Error("The PVO package header is incomplete.");
  const prefix = await readRange(0, PVO_CONTAINER_PREFIX_SIZE);
  if (!(prefix instanceof Uint8Array) || prefix.length !== PVO_CONTAINER_PREFIX_SIZE
    || !bytesEqual(prefix, 0, PVO_CONTAINER_MAGIC))
    throw new Error("No PVO package header was found.");
  const headerLength = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
    .getUint32(PVO_CONTAINER_MAGIC.length, false);
  if (!headerLength || headerLength > Math.min(maxHeaderBytes, PVO_CONTAINER_HEADER_LIMIT)
    || PVO_CONTAINER_PREFIX_SIZE + headerLength > size)
    throw new Error("The PVO package header length is invalid.");
  const headerBytes = await readRange(PVO_CONTAINER_PREFIX_SIZE, PVO_CONTAINER_PREFIX_SIZE + headerLength);
  if (!(headerBytes instanceof Uint8Array) || headerBytes.length !== headerLength)
    throw new Error("The PVO package header is incomplete.");
  let header;
  try {
    header = JSON.parse(textDecoder.decode(headerBytes));
  } catch (error) {
    throw new Error(`The PVO package header is not valid JSON: ${error.message}`);
  }
  if (header?.format !== "pvo" || header?.version !== PVO_CONTAINER_VERSION)
    throw new Error(`Unsupported PVO package version "${header?.version ?? "unknown"}".`);
  if (textEncoder.encode(JSON.stringify(header.manifest)).length > PVO_MANIFEST_LIMIT)
    throw new Error(`PVO manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  if (!Array.isArray(header.assets) || !header.assets.length)
    throw new Error("The PVO package has no media assets.");
  const payloadStart = PVO_CONTAINER_PREFIX_SIZE + headerLength;
  const payloadLength = size - payloadStart;
  const ids = new Set();
  const assets = header.assets.map((asset, index) => {
    const id = String(asset?.id || "").trim();
    const offset = Number(asset?.offset);
    const length = Number(asset?.length);
    if (!id) throw new Error(`PVO package asset ${index + 1} has no id.`);
    if (ids.has(id)) throw new Error(`PVO package asset id "${id}" is duplicated.`);
    ids.add(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0
      || offset + length > payloadLength)
      throw new Error(`PVO package asset "${id}" has an invalid byte range.`);
    return { id, name: String(asset.name || id), type: String(asset.type || "application/octet-stream"), offset, length };
  });
  const ordered = [...assets].sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < ordered.length; index += 1)
    if (ordered[index].offset < ordered[index - 1].offset + ordered[index - 1].length)
      throw new Error(`PVO package assets "${ordered[index - 1].id}" and "${ordered[index].id}" overlap.`);
  for (const media of header.manifest?.media || []) {
    const id = media?.asset_id || media?.id;
    if (id && !ids.has(id)) throw new Error(`PVO package is missing media asset "${id}".`);
  }
  return { manifest: header.manifest, validation: validatePvo(header.manifest), assets, payloadStart };
}
