import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFfmpegPlan } from "./ffmpeg-plan.js";
import { probeMedia, runProcess, supportsFilter } from "./process.js";
import { RenderInputError, validateRenderSource } from "./source.js";

export { RenderInputError, validateRenderSource } from "./source.js";

const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"]);
const WIDE_SDR_TRANSFERS = new Set(["bt709", "bt2020-10", "bt2020-12"]);
const BASE_HDR_FILTER = "zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited,format=yuv420p";
// HLG calibration was compared against decoded WebKit preview frames from
// low-light phone footage and a bright HLG colour chart.
const HDR_FILTERS = {
  "arib-std-b67": `${BASE_HDR_FILTER},eq=gamma=0.79:saturation=0.8`,
  smpte2084: BASE_HDR_FILTER,
};
const WIDE_FILTER = "zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited,format=yuv420p";

function gradientImage(width, height, first, last) {
  const firstRgb = [1, 3, 5].map(index => parseInt(first.slice(index, index + 2), 16));
  const lastRgb = [1, 3, 5].map(index => parseInt(last.slice(index, index + 2), 16));
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  const pixels = Buffer.allocUnsafe(width * height * 3);
  const diagonal = width * width + height * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const amount = Math.min(1, Math.max(0, ((x + .5) * width + (y + .5) * height) / diagonal));
      const pixel = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1)
        pixels[pixel + channel] = Math.round(firstRgb[channel] + (lastRgb[channel] - firstRgb[channel]) * amount);
    }
  }
  return Buffer.concat([header, pixels]);
}

function progressReader(durationSeconds, onProgress) {
  let pending = "";
  return chunk => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (match) onProgress?.(Math.min(.99, Math.max(0, Number(match[1]) / 1_000_000 / durationSeconds)));
    }
  };
}

/** Render one immutable scene from original uploaded sources into a high-quality MP4. */
export async function renderScene({
  source,
  media,
  outputPath,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
  signal,
  onProgress,
}) {
  const scene = validateRenderSource(source, media);
  if (typeof outputPath !== "string" || !path.isAbsolute(outputPath))
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The render output path must be absolute.");
  signal?.throwIfAborted();
  const scratch = await mkdtemp(path.join(tmpdir(), "restyle-render-"));
  let complete = false;
  try {
    const probes = new Map();
    for (const id of new Set([...scene.clips, ...scene.audioClips].flatMap(clip => clip.url ? [clip.url] : []))) {
      const file = media.get(id);
      if (typeof file !== "string" || !path.isAbsolute(file))
        throw new RenderInputError("MISSING_RENDER_SOURCE", `Source ${id} has no local media file.`);
      const info = await probeMedia(file, ffprobePath, signal);
      probes.set(id, info);
    }
    for (const [index, clip] of scene.clips.entries()) {
      if (!clip.url) continue;
      const probe = probes.get(clip.url);
      if (!probe.video)
        throw new RenderInputError("INVALID_RENDER_SOURCE", `Video clip ${index + 1} has no video track.`);
      if (clip.out > probe.duration + .1)
        throw new RenderInputError("INVALID_RENDER_SOURCE", `Video clip ${index + 1} extends beyond its source.`);
    }
    for (const [index, clip] of scene.audioClips.entries()) {
      const probe = probes.get(clip.url);
      if (!probe.audio)
        throw new RenderInputError("INVALID_RENDER_SOURCE", `Audio clip ${index + 1} has no audio track.`);
      if (clip.out > probe.duration + .1)
        throw new RenderInputError("INVALID_RENDER_SOURCE", `Audio clip ${index + 1} extends beyond its source.`);
    }
    const hdr = [...probes.values()].some(probe => probe.video &&
      (HDR_TRANSFERS.has(probe.video.color_transfer) || probe.video.color_primaries === "bt2020"));
    for (const probe of probes.values()) {
      if (probe.video?.color_primaries === "bt2020" &&
        !HDR_TRANSFERS.has(probe.video.color_transfer) &&
        !WIDE_SDR_TRANSFERS.has(probe.video.color_transfer))
        throw new RenderInputError("UNSUPPORTED_RENDER_FEATURE", "The source uses an unsupported wide-gamut colour transfer.");
    }
    if (hdr && !await supportsFilter(ffmpegPath, "zscale", signal))
      throw new RenderInputError("UNSUPPORTED_RENDER_FEATURE", "HDR export needs a renderer with zscale colour conversion.");

    const segments = [];
    const audioLayers = [];
    let timelineFrames = 0;
    for (const [index, clip] of scene.clips.entries()) {
      const frames = Math.max(1, Math.round((clip.out - clip.in) / clip.speed * scene.frameRate));
      let file = clip.url ? media.get(clip.url) : path.join(scratch, `gradient-${index}.ppm`);
      if (!clip.url) await writeFile(file, gradientImage(scene.width, scene.height, clip.color, clip.id === -1 ? "#000000" : "#15151c"));
      const probe = clip.url ? probes.get(clip.url) : null;
      segments.push({ input: index, path: file, clip, frames, probe, label: `v${index}` });
      if (!scene.muted && !clip.audioDetached && probe?.audio) {
        audioLayers.push({ input: 0, path: file, clip, start: timelineFrames / scene.frameRate, label: `a${audioLayers.length}` });
        // The audio stream belongs to this segment input, not the duplicate
        // standalone input used for independently timed extracted audio.
        audioLayers.at(-1).input = index;
        audioLayers.at(-1).embedded = true;
      }
      timelineFrames += frames;
    }
    for (const clip of scene.audioClips) {
      if (clip.muted) continue;
      audioLayers.push({ input: 0, path: media.get(clip.url), clip, start: clip.start, label: `a${audioLayers.length}`, embedded: false });
    }
    let nextInput = segments.length;
    for (const layer of audioLayers) if (!layer.embedded) layer.input = nextInput++;
    const plan = buildFfmpegPlan({ scene, segments, audioLayers, outputPath, hdrFilters: HDR_FILTERS, wideFilter: WIDE_FILTER });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await runProcess(ffmpegPath, plan.args, {
      signal,
      onStdout: progressReader(plan.durationSeconds, onProgress),
    });
    const result = await stat(outputPath);
    if (!result.size) throw new Error("The server renderer produced an empty video.");
    complete = true;
    onProgress?.(1);
    return {
      path: outputPath,
      contentType: "video/mp4",
      filename: "restyle-video.mp4",
      durationSeconds: plan.durationSeconds,
      width: scene.width,
      height: scene.height,
      bytes: result.size,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (!complete) await rm(outputPath, { force: true });
  }
}
