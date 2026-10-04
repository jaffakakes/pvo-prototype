import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

// Run against npm run dev:editor. The source's first 0.8s is a four-colour
// chart; the moving tail exposes startup holds and truncated exports.
const directory = await mkdtemp(join(tmpdir(), "pvo-export-quality-"));
const sourcePath = join(directory, "source.mp4");
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";

execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i",
  "color=c=0x6b6b6b:s=720x1280:r=30:d=0.8,"
    + "drawbox=x=0:y=0:w=360:h=640:color=0xb4445d:t=fill,"
    + "drawbox=x=360:y=0:w=360:h=640:color=0x49a55f:t=fill,"
    + "drawbox=x=0:y=640:w=360:h=640:color=0x454bbb:t=fill",
  "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=1.2",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
  "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
  "-map", "[v]", "-map", "2:a",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
  "-c:a", "aac", "-b:a", "128k",
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  "-movflags", "+faststart", sourcePath,
]);

function probeVideo(path) {
  const json = execFileSync("ffprobe", [
    "-v", "error", "-show_streams", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
    "-of", "json", path,
  ]);
  const stream = JSON.parse(json).streams[0];
  const packets = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_packets", "-show_entries", "packet=pts_time,duration_time,flags",
    "-of", "json", path,
  ])).packets;
  const last = packets.at(-1);
  const frameSeconds = 1 / Number(stream.avg_frame_rate.split("/")[0])
    * Number(stream.avg_frame_rate.split("/")[1]);
  return {
    ...stream,
    frames: packets.length,
    keyframes: packets.filter(packet => packet.flags?.includes("K")).length,
    end: Number(last.pts_time) + Number(last.duration_time || frameSeconds),
  };
}

function openingFrameBrightness(path) {
  const pixel = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", path,
    "-vf", "select='eq(n,0)',scale=1:1", "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
  assert.equal(pixel.length, 3, "Export must decode an opening frame");
  return [...pixel].reduce((sum, channel) => sum + channel, 0) / 3;
}

async function checkEngine(name, engine) {
  const browser = await engine.launch(name === "chromium" ? {
    executablePath: process.env.CHROME_PATH || (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  } : { headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/export-quality-source.mp4", route => route.fulfill({
      path: sourcePath,
      contentType: "video/mp4",
    }));
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    const result = await page.evaluate(async () => {
      const sourceBlob = await fetch("/export-quality-source.mp4").then(response => response.blob());
      const sourceUrl = URL.createObjectURL(sourceBlob);
      const { exportVideo } = await import("/src/infrastructure/media/exportVideo.ts");
      const clip = {
        id: 1, url: sourceUrl, color: "#000000", srcDur: 2,
        in: 0, out: 2, speed: 1, zoom: 1, mirror: false,
        width: 720, height: 1280, fit: "contain",
      };
      const exported = await exportVideo({
        clips: [clip], texts: [], components: [], layers: ["video"],
        muted: false, sound: 0, audioClips: [], ratio: "9:16", quality: "720p",
      }, () => {});

      const seek = async (url, time) => {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.src = url;
        await new Promise((resolve, reject) => {
          video.addEventListener("loadeddata", resolve, { once: true });
          video.addEventListener("error", reject, { once: true });
        });
        video.currentTime = time;
        await new Promise(resolve => video.addEventListener("seeked", resolve, { once: true }));
        return video;
      };
      const sampleChart = video => {
        const canvas = document.createElement("canvas");
        canvas.width = 180;
        canvas.height = 320;
        const context = canvas.getContext("2d");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return [[45, 80], [135, 80], [45, 240], [135, 240]].map(([x, y]) => {
          const pixels = context.getImageData(x - 5, y - 5, 10, 10).data;
          const rgb = [0, 0, 0];
          for (let index = 0; index < pixels.length; index += 4)
            for (let channel = 0; channel < 3; channel += 1)
              rgb[channel] += pixels[index + channel];
          return rgb.map(value => value / 100);
        });
      };
      const source = await seek(sourceUrl, 0.4);
      const output = await seek(exported.url, 0.4);
      const chart = { source: sampleChart(source), output: sampleChart(output) };
      const dimensions = { width: output.videoWidth, height: output.videoHeight };
      const link = document.createElement("a");
      link.href = exported.url;
      link.download = exported.name;
      link.click();
      source.remove();
      output.remove();
      URL.revokeObjectURL(sourceUrl);
      return { name: exported.name, mime: exported.blob.type, bytes: exported.blob.size, chart, dimensions };
    });
    const download = await downloadPromise;
    const outputPath = join(directory, `${name}-${download.suggestedFilename()}`);
    await download.saveAs(outputPath);
    const video = probeVideo(outputPath);
    const opening = openingFrameBrightness(outputPath);

    if (name === "webkit") {
      assert.equal(result.name, "restyle-video.mp4", "WebKit export needs its colour-faithful MP4 path");
      assert.equal(video.codec_name, "h264", "WebKit MP4 must contain H.264 video");
    }
    assert.equal(video.width, 720, `${name}: selected 720p width`);
    assert.equal(video.height, 1280, `${name}: selected 720p height`);
    assert(video.frames >= 45, `${name}: export must retain moving footage`);
    const durationError = video.end - 2;
    assert(opening > 20, `${name}: first encoded frame must show the colour chart, not black`);
    assert(video.keyframes <= video.frames / 4,
      `${name}: excessive keyframes (${video.keyframes}/${video.frames}) waste picture quality`);
    for (let patch = 0; patch < 4; patch += 1)
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(result.chart.source[patch][channel] - result.chart.output[patch][channel]);
        assert(delta <= 8, `${name}: patch ${patch + 1} channel ${channel + 1} changed by ${delta.toFixed(1)}`);
      }
    assert.deepEqual(errors, []);
    console.log(`${name}: ${result.name}, ${result.bytes} bytes, ${video.frames} frames, ${video.keyframes} keyframes, ${video.end.toFixed(3)}s (${durationError >= 0 ? "+" : ""}${durationError.toFixed(3)}s vs source), first-frame brightness ${opening.toFixed(1)}`);
  } finally {
    await browser.close();
  }
}

try {
  await checkEngine("chromium", chromium);
  await checkEngine("webkit", webkit);
  console.log("Export quality diagnostic: 720p output, source colours, moving footage and opening frame verified; encoded duration reported above.");
} finally {
  if (process.env.PVO_KEEP_QUALITY_ARTIFACTS)
    console.log(`Export quality artifacts: ${directory}`);
  else
    await rm(directory, { recursive: true, force: true });
}
