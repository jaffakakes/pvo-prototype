import { HttpError } from "../http.js";

const text = bytes => new TextDecoder("ascii").decode(bytes);
const invalid = () => { throw new HttpError(415, "This file is not a supported exported video container."); };

async function inspectMp4(source) {
  let offset = 0;
  let movie = false;
  let media = false;
  for (let count = 0; offset < source.size && count < 32; count += 1) {
    const header = await source.readRange(offset, Math.min(offset + 16, source.size));
    if (header.length < 8) invalid();
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let size = view.getUint32(0, false);
    const type = text(header.subarray(4, 8));
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) invalid();
      size = Number(view.getBigUint64(8, false));
      headerSize = 16;
    } else if (size === 0) size = source.size - offset;
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > source.size) invalid();
    if (offset === 0) {
      if (type !== "ftyp" || size < 16 || size > 4096) invalid();
      const brands = text(await source.readRange(offset + 8, offset + size));
      if (!/(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)/.test(brands)) invalid();
    }
    if (type === "moov" && size > headerSize) movie = true;
    if (type === "mdat" && size > headerSize) media = true;
    offset += size;
  }
  if (offset !== source.size || !movie || !media) invalid();
}

function vint(bytes, offset, keepMarker = false) {
  const first = bytes[offset];
  if (!first) invalid();
  let width = 1;
  while (width <= 8 && !(first & (1 << (8 - width)))) width += 1;
  if (width > 8 || offset + width > bytes.length) invalid();
  let value = keepMarker ? first : first & ((1 << (8 - width)) - 1);
  let unknown = !keepMarker && value === ((1 << (8 - width)) - 1);
  for (let index = 1; index < width; index += 1) {
    value = value * 256 + bytes[offset + index];
    unknown &&= bytes[offset + index] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value)) invalid();
  return { width, value, unknown };
}

function element(bytes, offset) {
  const id = vint(bytes, offset, true);
  const size = vint(bytes, offset + id.width);
  return { id: id.value, start: offset + id.width + size.width, size: size.unknown ? null : size.value };
}

async function inspectWebm(source) {
  const bytes = await source.readRange(0, Math.min(65536, source.size));
  const header = element(bytes, 0);
  if (header.id !== 0x1a45dfa3 || header.size === null || header.size > 4096) invalid();
  const end = header.start + header.size;
  let offset = header.start;
  let webm = false;
  while (offset < end) {
    const child = element(bytes, offset);
    if (child.size === null || child.start + child.size > end) invalid();
    if (child.id === 0x4282) webm = text(bytes.subarray(child.start, child.start + child.size)) === "webm";
    offset = child.start + child.size;
  }
  if (!webm || offset !== end) invalid();
  const segment = element(bytes, end);
  if (segment.id !== 0x18538067 || (segment.size !== null && segment.start + segment.size > source.size)) invalid();
  offset = segment.start;
  let tracks = false;
  for (let count = 0; offset < bytes.length && count < 64; count += 1) {
    const child = element(bytes, offset);
    if (child.size !== null && child.start + child.size > source.size) invalid();
    if (child.id === 0x1654ae6b && child.size > 0) tracks = true;
    if (child.id === 0x1f43b675 && tracks && child.start < source.size) return;
    if (child.size === null) invalid();
    offset = child.start + child.size;
  }
  invalid();
}

export async function inspectVideo(source, type) {
  if (type === "video/mp4") await inspectMp4(source);
  else if (type === "video/webm") await inspectWebm(source);
  else invalid();
  return type;
}
