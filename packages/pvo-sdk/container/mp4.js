import { textDecoder, bytesEqual, concatBytes, textEncoder, toBytes, mediaMimeType } from "./binary.js";
import { PVO_UUID_BYTES, MANIFEST_SUBTYPE, UUID_TYPE } from "./constants.js";
import { PVO_MANIFEST_LIMIT } from "../manifest/constants.js";
import { validatePvo } from "../manifest/validate.js";

function readBoxSize(view, offset, available) {
  const smallSize = view.getUint32(offset, false);
  if (smallSize === 0) return { size: available, headerSize: 8, extendsToEnd: true };
  if (smallSize !== 1) return { size: smallSize, headerSize: 8, extendsToEnd: false };
  if (offset + 16 > view.byteLength) throw new Error("Invalid extended media box header.");
  const largeSize = view.getBigUint64(offset + 8, false);
  if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("This media file is too large for the browser prototype.");
  }
  return { size: Number(largeSize), headerSize: 16, extendsToEnd: false };
}

export function inspectMp4(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      throw new Error(`Invalid media file: ${bytes.length - offset} trailing byte(s) after the last box.`);
    }
    const { size, headerSize, extendsToEnd } = readBoxSize(view, offset, bytes.length - offset);
    if (size < headerSize || offset + size > bytes.length) {
      throw new Error(`Invalid media box at byte ${offset}.`);
    }
    const type = textDecoder.decode(bytes.subarray(offset + 4, offset + 8));
    const uuidOffset = offset + headerSize;
    const payloadOffset = type === "uuid" ? uuidOffset + 16 : offset + headerSize;
    if (type === "uuid" && payloadOffset > offset + size) {
      throw new Error(`Invalid uuid box at byte ${offset}.`);
    }
    boxes.push({ offset, size, headerSize, type, uuidOffset, payloadOffset, extendsToEnd });
    offset += size;
  }

  return boxes;
}

export function isManifestBox(bytes, box) {
  return (
    box.type === "uuid" &&
    bytesEqual(bytes, box.uuidOffset, PVO_UUID_BYTES) &&
    bytesEqual(bytes, box.payloadOffset, MANIFEST_SUBTYPE)
  );
}

export function stripPvoBoxes(bytes, boxes) {
  const chunks = [];
  for (const box of boxes) {
    if (isManifestBox(bytes, box)) continue;
    let chunk = bytes.slice(box.offset, box.offset + box.size);
    // A size=0 box claims the rest of the file. Give it an explicit size before
    // appending PVO data so normal media parsers can continue to the new box.
    if (box.extendsToEnd) {
      if (chunk.length > 0xffffffff) {
        throw new Error("A size=0 media box larger than 4 GB is not supported by this prototype.");
      }
      new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).setUint32(0, chunk.length, false);
    }
    chunks.push(chunk);
  }
  return concatBytes(chunks);
}

function makeManifestBox(manifest) {
  const json = textEncoder.encode(JSON.stringify(manifest));
  if (json.length > PVO_MANIFEST_LIMIT) {
    throw new Error(`Manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  }
  const size = 8 + PVO_UUID_BYTES.length + MANIFEST_SUBTYPE.length + json.length;
  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size, false);
  box.set(UUID_TYPE, 4);
  box.set(PVO_UUID_BYTES, 8);
  box.set(MANIFEST_SUBTYPE, 24);
  box.set(json, 28);
  return box;
}

/** Append or replace the PVO manifest in an MP4 or MOV while preserving its media type. */
export async function packPvo(media, manifest) {
  const result = validatePvo(manifest);
  if (!result.valid) {
    throw new Error(`Invalid PVO manifest:\n${result.errors.join("\n")}`);
  }
  const bytes = await toBytes(media);
  const boxes = inspectMp4(bytes);
  if (!boxes.some((box) => box.type === "ftyp")) {
    throw new Error("This file does not look like an MP4 or MOV (missing ftyp box).");
  }
  const base = stripPvoBoxes(bytes, boxes);
  return new Blob([base, makeManifestBox(manifest)], { type: mediaMimeType(media) });
}
