import { RenderInputError } from "./source.js";

const seconds = value => Number(value.toFixed(6)).toString();

function tempoFilters(speed) {
  const filters = [];
  let remaining = speed;
  while (remaining < .5) { filters.push("atempo=0.5"); remaining /= .5; }
  while (remaining > 2) { filters.push("atempo=2"); remaining /= 2; }
  if (Math.abs(remaining - 1) > .000001) filters.push(`atempo=${seconds(remaining)}`);
  return filters;
}

function sourceAudioFilter(input, clip, start, label) {
  const length = (clip.out - clip.in) / clip.speed;
  return `[${input}:a]atrim=start=${seconds(clip.in)}:end=${seconds(clip.out)},asetpts=PTS-STARTPTS,${[
    ...tempoFilters(clip.speed),
    "aresample=48000:async=1:first_pts=0",
    "apad",
    `atrim=duration=${seconds(length)}`,
    `adelay=${Math.round(start * 1000)}:all=1`,
  ].join(",")}[${label}]`;
}

function videoFilter(segment, width, height, frameRate, hdrFilters, wideFilter) {
  const { input, clip, frames, probe, label } = segment;
  if (!clip.url) {
    return `[${input}:v]trim=end_frame=${frames},setpts=N/(${frameRate}*TB),format=yuv420p,setsar=1[${label}]`;
  }
  const filters = [
    `trim=start=${seconds(clip.in)}:end=${seconds(clip.out)}`,
    `setpts=(PTS-STARTPTS)/${seconds(clip.speed)}`,
  ];
  if (hdrFilters[probe.video.color_transfer]) filters.push(hdrFilters[probe.video.color_transfer]);
  else if (probe.video.color_primaries === "bt2020") filters.push(wideFilter);
  filters.push(`scale=${width}:${height}:force_original_aspect_ratio=${clip.fit === "cover" ? "increase" : "decrease"}:force_divisible_by=2:flags=lanczos`);
  if (clip.zoom !== 1)
    filters.push(`scale=trunc(iw*${seconds(clip.zoom)}/2)*2:trunc(ih*${seconds(clip.zoom)}/2)*2:flags=lanczos`);
  if (clip.fit === "cover") filters.push(`crop=${width}:${height}`);
  else filters.push(`crop=w=min(iw\\,${width}):h=min(ih\\,${height})`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`);
  if (clip.mirror) filters.push("hflip");
  filters.push(
    `fps=${frameRate}:round=near`,
    "tpad=stop_mode=clone:stop_duration=1",
    `trim=end_frame=${frames}`,
    `setpts=N/(${frameRate}*TB)`,
    "format=yuv420p",
    "setsar=1",
  );
  return `[${input}:v]${filters.join(",")}[${label}]`;
}

/** Build an offline, frame-counted FFmpeg render from already probed local media. */
export function buildFfmpegPlan({ scene, segments, audioLayers, outputPath, hdrFilters, wideFilter }) {
  const { width, height, frameRate } = scene;
  const graph = [];
  const videoLabels = [];
  let encodedFrames = 0;
  for (const segment of segments) {
    graph.push(videoFilter(segment, width, height, frameRate, hdrFilters, wideFilter));
    videoLabels.push(`[${segment.label}]`);
    encodedFrames += segment.frames;
  }
  const expectedFrames = Math.max(encodedFrames, Math.round(scene.durationSeconds * frameRate));
  const tailFrames = expectedFrames - encodedFrames;
  if (tailFrames > 0) {
    graph.push(`color=c=black:s=${width}x${height}:r=${frameRate}:d=${seconds(tailFrames / frameRate)},trim=end_frame=${tailFrames},setpts=N/(${frameRate}*TB),format=yuv420p,setsar=1[vtail]`);
    videoLabels.push("[vtail]");
  }
  if (!videoLabels.length)
    throw new RenderInputError("INVALID_RENDER_SOURCE", "The scene has no frames to render.");
  if (videoLabels.length === 1) graph.push(`${videoLabels[0]}null[vout]`);
  else graph.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);

  const durationSeconds = expectedFrames / frameRate;
  graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(durationSeconds)},asetpts=PTS-STARTPTS[asilence]`);
  const audioLabels = ["[asilence]"];
  for (const layer of audioLayers) {
    graph.push(sourceAudioFilter(layer.input, layer.clip, layer.start, layer.label));
    audioLabels.push(`[${layer.label}]`);
  }
  graph.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,atrim=duration=${seconds(durationSeconds)},asetpts=PTS-STARTPTS[aout]`);
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
  ];
  for (const segment of segments) {
    if (segment.clip.url) args.push("-i", segment.path);
    else args.push("-loop", "1", "-framerate", String(frameRate), "-i", segment.path);
  }
  for (const layer of audioLayers) if (!layer.embedded) args.push("-i", layer.path);
  args.push(
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", String(frameRate), "-frames:v", String(expectedFrames),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-f", "mp4", outputPath,
  );
  return { args, durationSeconds, expectedFrames, filterGraph: graph.join(";") };
}
