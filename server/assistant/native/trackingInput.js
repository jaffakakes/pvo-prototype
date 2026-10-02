import { objectTrackingTimes, TRACKING_MAX_EDGE, TRACKING_MAX_FRAME_BYTES,
  TRACKING_MAX_REQUEST_BYTES } from "../../../packages/pvo-assistant/native/index.js";
import { HttpError } from "../../http.js";

const invalid = () => new HttpError(400, "Send sequential video frames and one object to track for up to ten seconds.");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

function jpegSize(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > TRACKING_MAX_FRAME_BYTES
    || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw invalid();
  let bytes;
  try { bytes = Uint8Array.from(atob(dataUrl.slice(23)), character => character.charCodeAt(0)); }
  catch { throw invalid(); }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw invalid();
  const read = at => bytes[at] * 256 + bytes[at + 1];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = read(offset);
    if (size < 2 || offset + size > bytes.length) throw invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 8) throw invalid();
      return { width: read(offset + 5), height: read(offset + 3) };
    }
    offset += size;
  }
  throw invalid();
}

/** No URLs, paths, model identifiers or unbounded images cross the tracking boundary. */
export function parseTrackingInput(value) {
  if (!exact(value, ["sceneId", "clipId", "start", "end", "target", "width", "height", "frames"])
    || typeof value.sceneId !== "string" || !value.sceneId.trim() || value.sceneId.length > 200
    || !Number.isSafeInteger(value.clipId) || value.clipId < 0
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < 1 || value.height < 1 || Math.max(value.width, value.height) > TRACKING_MAX_EDGE) throw invalid();
  let times;
  try { times = objectTrackingTimes(value.start, value.end); } catch { throw invalid(); }
  const target = value.target;
  if (target?.kind === "text") {
    if (!exact(target, ["kind", "text"]) || typeof target.text !== "string"
      || !target.text.trim() || target.text.length > 200) throw invalid();
  } else if (target?.kind === "point") {
    if (!exact(target, ["kind", "x", "y"]) || !Number.isFinite(target.x) || !Number.isFinite(target.y)
      || target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1) throw invalid();
  } else throw invalid();
  if (!Array.isArray(value.frames) || value.frames.length !== times.length) throw invalid();
  let size = 0;
  const frames = value.frames.map((frame, index) => {
    if (!exact(frame, ["time", "imageDataUrl"]) || !Number.isFinite(frame.time)
      || Math.abs(frame.time - times[index]) > 0.000001) throw invalid();
    const dimensions = jpegSize(frame.imageDataUrl);
    if (dimensions.width !== value.width || dimensions.height !== value.height) throw invalid();
    size += frame.imageDataUrl.length;
    if (size > TRACKING_MAX_REQUEST_BYTES - 128 * 1024) throw new HttpError(413, "The tracking frames are too large.");
    return { time: times[index], imageDataUrl: frame.imageDataUrl };
  });
  return { sceneId: value.sceneId, clipId: value.clipId, start: value.start, end: value.end,
    target: target.kind === "text" ? { kind: "text", text: target.text } : { kind: "point", x: target.x, y: target.y },
    width: value.width, height: value.height, frames };
}
