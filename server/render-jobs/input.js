import { HttpError } from "../http.js";
import { unsupportedRenderEffects } from "../render/features.js";
import { RenderInputError, validateRenderSource } from "../render/source.js";

export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_SOURCES = 16;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COMPONENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CONTENT_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "audio/mp4",
  "audio/mpeg", "audio/wav", "audio/x-wav", "application/octet-stream"]);

function invalid(message = "This video cannot be rendered on the server.") {
  throw new HttpError(422, message);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function assetUrl(value, ids) {
  if (value === null) return null;
  if (typeof value !== "string" || !ids.has(value)) invalid("Every source must be uploaded for this render.");
  return value;
}

function clipInput(value, ids) {
  if (!object(value) || !Number.isSafeInteger(value.id) || !finite(value.srcDur, .001, 7200)
    || !finite(value.in, 0, value.srcDur) || !finite(value.out, value.in + .001, value.srcDur)
    || !finite(value.speed, .25, 4) || !finite(value.zoom, .1, 10)
    || !finite(value.width, 1, 16384) || !finite(value.height, 1, 16384)
    || typeof value.mirror !== "boolean" || !["cover", "contain"].includes(value.fit)
    || typeof value.color !== "string" || !/^#[\da-fA-F]{3,8}$/.test(value.color)) invalid();
  return { id: value.id, url: assetUrl(value.url, ids), color: value.color,
    srcDur: value.srcDur, in: value.in, out: value.out, speed: value.speed,
    zoom: value.zoom, mirror: value.mirror, width: value.width, height: value.height,
    fit: value.fit, audioDetached: value.audioDetached === true };
}

function audioInput(value, ids) {
  if (!object(value) || !Number.isSafeInteger(value.id) || !finite(value.srcDur, .001, 7200)
    || !finite(value.in, 0, value.srcDur) || !finite(value.out, value.in + .001, value.srcDur)
    || !finite(value.speed, .25, 4) || !finite(value.start, 0, 7200)
    || typeof value.muted !== "boolean") invalid();
  return { id: value.id, url: assetUrl(value.url, ids), name: "Audio",
    srcDur: value.srcDur, in: value.in, out: value.out, speed: value.speed,
    start: value.start, muted: value.muted };
}

export function renderInput(body) {
  if (!object(body) || !object(body.source) || !Array.isArray(body.assets)
    || body.assets.length > MAX_SOURCES) invalid();
  const ids = new Set();
  let totalBytes = 0;
  const assets = body.assets.map(asset => {
    if (!object(asset) || typeof asset.id !== "string" || !ASSET_ID.test(asset.id) || ids.has(asset.id)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_SOURCE_BYTES
      || typeof asset.contentType !== "string" || !CONTENT_TYPES.has(asset.contentType)) invalid();
    ids.add(asset.id);
    totalBytes += asset.bytes;
    return { id: asset.id, bytes: asset.bytes, contentType: asset.contentType };
  });
  if (totalBytes > MAX_TOTAL_BYTES) throw new HttpError(413, "This render has too much source footage.");
  const source = body.source;
  if (!["720p", "1080p", "4K"].includes(source.quality) || !["9:16", "1:1", "4:5", "16:9"].includes(source.ratio)
    || !Array.isArray(source.clips) || source.clips.length > 100
    || !Array.isArray(source.texts) || source.texts.length > 100
    || !Array.isArray(source.components) || source.components.length > 100
    || !Array.isArray(source.audioClips ?? []) || (source.audioClips?.length ?? 0) > 100
    || typeof source.muted !== "boolean" || !finite(source.sound, 0, 1)) invalid();
  if (source.includeText !== undefined && typeof source.includeText !== "boolean") invalid();
  const unsupported = unsupportedRenderEffects(source);
  if (unsupported) invalid(`${unsupported} Use browser export for this edit.`);
  if (source.sound > 0)
    invalid("This soundtrack needs browser export for now.");
  const texts = source.texts.map(text => {
    if (!object(text) || !Number.isSafeInteger(text.id)
      || !finite(text.start, 0, 120) || !finite(text.end, text.start, 120)) invalid();
    return { id: text.id, start: text.start, end: text.end };
  });
  const components = source.components.map(component => {
    if (!object(component) || typeof component.id !== "string" || !COMPONENT_ID.test(component.id)
      || !finite(component.at, 0, 120)
      || !(component.dur === null || finite(component.dur, 0, 120))) invalid();
    return { id: component.id, at: component.at, dur: component.dur };
  });
  const validLayers = new Set(["video", ...texts.map(text => `text:${text.id}`),
    ...components.map(component => `component:${component.id}`)]);
  if (source.layers !== undefined && (!Array.isArray(source.layers) || source.layers.length > 201
    || source.layers.some(layer => typeof layer !== "string" || !validLayers.has(layer)))) invalid();
  const layers = source.layers === undefined ? undefined : [...new Set(source.layers)];
  const cleanSource = { ratio: source.ratio, quality: source.quality,
    clips: source.clips.map(clip => clipInput(clip, ids)),
    audioClips: (source.audioClips ?? []).map(clip => audioInput(clip, ids)),
    texts, components, layers, muted: source.muted, sound: 0, includeText: source.includeText !== false };
  try {
    // Share the renderer's exact supported ranges and duration calculation so
    // invalid jobs fail before their original media is uploaded.
    validateRenderSource(cleanSource, new Map([...ids].map(id => [id, null])));
  } catch (error) {
    if (error instanceof RenderInputError && error.code === "UNSUPPORTED_RENDER_FEATURE")
      invalid("This edit uses visible text that needs browser export for now.");
    if (error instanceof RenderInputError) invalid(error.message);
    throw error;
  }
  return { source: cleanSource, assets, totalBytes };
}

export function validAssetId(value) {
  return ASSET_ID.test(value);
}
