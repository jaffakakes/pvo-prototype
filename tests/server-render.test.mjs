import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderScene, validateRenderSource } from "../server/render/render-scene.js";

function source(overrides = {}) {
  return {
    ratio: "9:16", quality: "720p", clips: [{
      id: 1, url: "source_1", color: "#ff758f", srcDur: 2, in: 0, out: 1,
      speed: 1, zoom: 1, mirror: false, fit: "cover", width: 720, height: 1280,
    }],
    audioClips: [], texts: [], components: [], layers: ["video"], muted: false, sound: 0,
    ...overrides,
  };
}

test("server render validates a scene before upload and preserves a component tail", () => {
  const checked = validateRenderSource(source({ components: [{ at: 1, dur: 1.5 }] }));
  assert.equal(checked.durationSeconds, 2.5);
  assert.deepEqual([checked.width, checked.height], [720, 1280]);
  assert.throws(() => validateRenderSource(source({ sound: 1 })), { code: "UNSUPPORTED_RENDER_FEATURE" });
  assert.throws(() => validateRenderSource(source({ texts: [{ id: 3, start: 0, end: 1 }], layers: ["video", "text:3"] })), { code: "UNSUPPORTED_RENDER_FEATURE" });
  assert.doesNotThrow(() => validateRenderSource(source({ texts: [{ id: 3, start: 0, end: 1 }], layers: ["text:3", "video"] })));
  assert.throws(() => validateRenderSource(source({ clips: [{ ...source().clips[0], url: "blob:http://example.test/x" }] })), { code: "INVALID_RENDER_SOURCE" });
});

test("server renderer rejects audio gain and motion it cannot reproduce", () => {
  const animated = { tracks: { gain: [{ time: 0, value: .5, easing: "linear" }] } };
  const unsupported = [
    source({ clipGain: .5 }),
    source({ musicGain: .5 }),
    source({ musicAnimation: animated }),
    source({ clips: [{ ...source().clips[0], animation: animated }] }),
    source({ audioClips: [{ ...source().clips[0], start: 0, gain: .5 }] }),
    source({ audioClips: [{ ...source().clips[0], start: 0, animation: animated }] }),
  ];
  for (const scene of unsupported)
    assert.throws(() => validateRenderSource(scene), { code: "UNSUPPORTED_RENDER_FEATURE" });
});

test("server renderer plans true 4K portrait and landscape frames without encoding media", () => {
  const portrait = validateRenderSource(source({ quality: "4K" }));
  const landscape = validateRenderSource(source({ quality: "4K", ratio: "16:9" }));
  assert.deepEqual([portrait.width, portrait.height], [2160, 3840]);
  assert.deepEqual([landscape.width, landscape.height], [3840, 2160]);
  assert.equal(portrait.frameRate, 30);
  assert.equal(landscape.durationSeconds, 1);
});

const ffmpegPath = process.env.PVO_FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.PVO_FFPROBE_PATH || "ffprobe";
const ffmpegAvailable = spawnSync(ffmpegPath, ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync(ffprobePath, ["-version"], { stdio: "ignore" }).status === 0;

test("server render uses original media and produces frame-counted MP4 with authored tail", { skip: !ffmpegAvailable }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "restyle-render-test-"));
  try {
    const input = path.join(directory, "original.mp4");
    const output = path.join(directory, "export.mp4");
    const fixture = spawnSync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", input,
    ], { encoding: "utf8" });
    assert.equal(fixture.status, 0, fixture.stderr);
    const progress = [];
    const result = await renderScene({
      source: source({
        clips: [
          { ...source().clips[0], in: .25, out: 1.25, speed: 2, mirror: true, zoom: 1.2 },
          { ...source().clips[0], id: 2, url: null, color: "#2ec4b6", in: 0, out: .5 },
        ],
        components: [{ at: 1, dur: .5 }],
      }),
      media: new Map([["source_1", input]]), outputPath: output, ffmpegPath, ffprobePath,
      onProgress: fraction => progress.push(fraction),
    });
    assert.equal(result.contentType, "video/mp4");
    assert.deepEqual([result.width, result.height], [720, 1280]);
    assert.equal(result.durationSeconds, 1.5);
    assert.ok(result.bytes > 10_000);
    assert.equal(progress.at(-1), 1);
    const probe = spawnSync(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", output], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const details = JSON.parse(probe.stdout);
    assert.ok(Math.abs(Number(details.format.duration) - 1.5) < .05);
    assert.ok(details.streams.some(stream => stream.codec_name === "h264" && stream.width === 720 && stream.height === 1280));
    assert.ok(details.streams.some(stream => stream.codec_name === "aac"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
