import { unsupportedRenderEffects } from "./features.js";

const RATIOS = { "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9] };
const FRAME_RATE = 30;
const MAX_SCENE_SECONDS = 120;
const MAX_SOURCE_SECONDS = 7200;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class RenderInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RenderInputError";
    this.code = code;
  }
}

function requireNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new RenderInputError("INVALID_RENDER_SOURCE", `${label} is outside its allowed range.`);
  return value;
}

function mediaId(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !ASSET_ID.test(value))
    throw new RenderInputError("INVALID_RENDER_SOURCE", `${label} must name an uploaded source.`);
  return value;
}

function clipDuration(clip) {
  return (clip.out - clip.in) / clip.speed;
}

function componentEnd(component, clips, videoDuration) {
  const at = requireNumber(component?.at, "Component start", 0, MAX_SCENE_SECONDS);
  if (component.dur !== null) {
    return at + requireNumber(component.dur, "Component duration", 0, MAX_SCENE_SECONDS);
  }
  let start = 0;
  for (const clip of clips) {
    const end = start + clipDuration(clip);
    if (at < end || clip === clips.at(-1)) return Math.min(videoDuration, end);
    start = end;
  }
  return videoDuration;
}

function visibleTexts(source) {
  if (source.includeText === false) return [];
  const texts = source.texts ?? [];
  const components = source.components ?? [];
  const valid = ["video", ...texts.map(text => `text:${text.id}`), ...components.map(component => `component:${component.id}`)];
  const existing = [...new Set(source.layers ?? valid)].filter(id => valid.includes(id));
  const layers = [...existing, ...valid.filter(id => !existing.includes(id))];
  const videoLayer = layers.indexOf("video");
  return texts.filter(text => layers.indexOf(`text:${text.id}`) > videoLayer && text.end > text.start);
}

/** Validate the one-scene export contract before constructing any FFmpeg command. */
export function validateRenderSource(source, media = null) {
  if (!source || typeof source !== "object" || !Array.isArray(source.clips) || !Array.isArray(source.texts) || !Array.isArray(source.components))
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The render scene is incomplete.");
  if (media !== null && !(media instanceof Map))
    throw new RenderInputError("INVALID_RENDER_SOURCE", "Render media must be a source map.");
  const ratio = RATIOS[source.ratio];
  if (!ratio || !["720p", "1080p", "4K"].includes(source.quality))
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The export ratio or quality is unsupported.");
  if (source.clips.length > 200 || (source.audioClips ?? []).length > 200)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The scene has too many media clips.");
  const unsupported = unsupportedRenderEffects(source);
  if (unsupported) throw new RenderInputError("UNSUPPORTED_RENDER_FEATURE", unsupported);
  if (visibleTexts(source).length)
    throw new RenderInputError("UNSUPPORTED_RENDER_FEATURE", "Server export does not yet support visible text overlays.");
  if (source.sound !== 0)
    throw new RenderInputError("UNSUPPORTED_RENDER_FEATURE", "Server export does not yet support the selected soundtrack.");
  const clips = source.clips.map((clip, index) => {
    const label = `Video clip ${index + 1}`;
    const id = mediaId(clip?.url, `${label} source`);
    const from = requireNumber(clip?.in, `${label} in`, 0, MAX_SOURCE_SECONDS);
    const out = requireNumber(clip?.out, `${label} out`, 0, MAX_SOURCE_SECONDS);
    const speed = requireNumber(clip?.speed, `${label} speed`, .25, 4);
    const zoom = requireNumber(clip?.zoom, `${label} zoom`, 1, 2);
    if (out <= from || !["cover", "contain"].includes(clip.fit))
      throw new RenderInputError("INVALID_RENDER_SOURCE", `${label} has invalid timing or fit.`);
    if (id && media && !media.has(id))
      throw new RenderInputError("MISSING_RENDER_SOURCE", `${label} was not uploaded.`);
    if (!id && !/^#[0-9a-fA-F]{6}$/.test(clip.color))
      throw new RenderInputError("INVALID_RENDER_SOURCE", `${label} has an invalid background colour.`);
    return { ...clip, url: id, in: from, out, speed, zoom };
  });
  const audioClips = (source.audioClips ?? []).map((clip, index) => {
    const label = `Audio clip ${index + 1}`;
    const id = mediaId(clip?.url, `${label} source`);
    const from = requireNumber(clip?.in, `${label} in`, 0, MAX_SOURCE_SECONDS);
    const out = requireNumber(clip?.out, `${label} out`, 0, MAX_SOURCE_SECONDS);
    const speed = requireNumber(clip?.speed, `${label} speed`, .25, 4);
    const start = requireNumber(clip?.start, `${label} start`, 0, MAX_SCENE_SECONDS);
    if (!id || (media && !media.has(id)) || out <= from)
      throw new RenderInputError("MISSING_RENDER_SOURCE", `${label} is missing its source or has invalid timing.`);
    return { ...clip, url: id, in: from, out, speed, start };
  });
  const videoDuration = clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  const textEnds = source.texts.map(text => requireNumber(text.end, "Text end", 0, MAX_SCENE_SECONDS));
  const componentEnds = source.components.map(component => componentEnd(component, clips, videoDuration));
  const audioEnds = audioClips.map(clip => clip.start + clipDuration(clip));
  const durationSeconds = Math.max(videoDuration, ...textEnds, ...componentEnds, ...audioEnds);
  if (!(durationSeconds > 0) || durationSeconds > MAX_SCENE_SECONDS)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The scene must be between 0 and 120 seconds long.");
  const short = source.quality === "4K" ? 2160 : source.quality === "1080p" ? 1080 : 720;
  const [rw, rh] = ratio;
  const width = rw <= rh ? short : Math.round(short * rw / rh / 2) * 2;
  const height = rw <= rh ? Math.round(short * rh / rw / 2) * 2 : short;
  return { clips, audioClips, durationSeconds, width, height, frameRate: FRAME_RATE, muted: source.muted === true };
}
