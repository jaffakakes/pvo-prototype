import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

// Real decoding/canvas capture of a deterministic video. No tracker/AI inference.
const directory = await mkdtemp(join(tmpdir(), "pvo-tracking-capture-"));
const media = join(directory, "source.mp4");
let browser;
try {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=black:s=320x180:d=2:r=30,drawbox=x=40:y=60:w=40:h=40:color=red:t=fill:enable='lt(t,1)',drawbox=x=240:y=60:w=40:h=40:color=blue:t=fill:enable='gte(t,1)'",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", media]);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async base64 => {
    const { captureTrackingFrame, captureTrackingFrames } = await import("/src/infrastructure/assistant/media/trackingFrames.ts");
    const { useCapture } = await import("/src/state/captureStore.ts");
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    const clip = { id: 1, url, srcDur: 2, in: .5, out: 1.5, speed: 2, color: "#000", zoom: 1,
      mirror: true, width: 320, height: 180, fit: "contain", animation: { tracks: { x: [{ time: 0, value: 10, easing: "linear" }] } } };
    const project = { ratio: "16:9", scenes: [{ id: "main", name: "Main", parent: null, clips: [clip],
      texts: [{ id: 2, text: "SHOULD NOT TRACK TEXT", x: 50, y: 50, start: 0, end: 2, color: 0 }], components: [], muted: true, sound: 0 }] };
    const request = { kind: "object_tracking", sceneId: "main", clipId: 1, start: 0, end: .5,
      target: { kind: "point", x: .9, y: .45 } };
    useCapture.getState().patch({ t: .123 });
    const before = useCapture.getState().t;
    const videos = [];
    const canvases = [];
    const create = document.createElement.bind(document);
    document.createElement = function(tag, ...args) {
      const element = create(tag, ...args);
      if (tag === "video") videos.push(element);
      if (tag === "canvas") canvases.push(element);
      return element;
    };
    try {
      const preview = await captureTrackingFrame(project, request);
      const capture = await captureTrackingFrames(project, request);
      const slowProject = { ...project, scenes: [{ ...project.scenes[0], clips: [{ ...clip, speed: .25 }] }] };
      const slow = await captureTrackingFrames(slowProject, { ...request, end: .2 });
      const captureCanvases = [...canvases];
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error("Capture cancelled")), 5);
      let cancelled = false;
      try { await captureTrackingFrames(project, request, abort.signal); }
      catch (error) { cancelled = error.message === "Capture cancelled"; }
      finally { clearTimeout(timer); }
      document.createElement = create;
      const inspect = async dataUrl => {
        const image = new Image(); image.src = dataUrl; await image.decode();
        const canvas = create("canvas"); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const red = { total: 0, x: 0 }, blue = { total: 0, x: 0 }; let white = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const [r, g, b] = pixels.slice(index, index + 3);
          const point = r > 130 && g < 70 && b < 70 ? red : b > 100 && r < 70 && g < 70 ? blue : null;
          if (point) { point.total++; point.x += (index / 4) % canvas.width; }
          if (r > 180 && g > 180 && b > 180) white++;
        }
        return { red: red.total ? red.x / red.total : null, blue: blue.total ? blue.x / blue.total : null, white };
      };
      return { width: capture.width, height: capture.height, times: capture.frames.map(frame => frame.time),
        slowFrames: slow.frames.length,
        sameFirst: preview.dataUrl === capture.frames[0].imageDataUrl,
        first: await inspect(capture.frames[0].imageDataUrl), last: await inspect(capture.frames.at(-1).imageDataUrl),
        cancelled,
        unchangedPlayhead: useCapture.getState().t === before,
        releasedVideos: videos.every(video => !video.getAttribute("src") && video.paused),
        releasedOutputCanvases: captureCanvases.filter((_, index) => index % 2 === 0).every(canvas => canvas.width === 0 && canvas.height === 0),
      };
    } finally { document.createElement = create; URL.revokeObjectURL(url); }
  }, (await readFile(media)).toString("base64"));
  assert.equal(result.width, 640); assert.equal(result.height, 360);
  assert.equal(result.times.length, 9); assert.equal(result.times[0], 0); assert.equal(result.times.at(-1), .5);
  assert(Math.abs(result.first.red - 584) < 3, `Mirror plus animated clip offset must move first red target: ${JSON.stringify(result.first)}`);
  assert(Math.abs(result.last.blue - 184) < 3, `Trim/speed sampling must reach blue target in final source frame: ${JSON.stringify(result.last)}`);
  assert.equal(result.first.blue, null); assert.equal(result.last.red, null);
  assert.equal(result.first.white, 0); assert.equal(result.last.white, 0);
  assert.equal(result.slowFrames, 4, "Sub-frame seeks on slow clips remain decodable");
  assert(result.sameFirst, "Point-selection snapshot is exactly the first tracking frame");
  assert(result.cancelled, "Aborting actual decoder capture settles without leaking media");
  assert(result.unchangedPlayhead); assert(result.releasedVideos); assert(result.releasedOutputCanvases);
  assert.deepEqual(errors, []);
  console.log("PASS: actual tracking video capture, 15fps endpoints, source trim/speed, mirror+animation, text exclusion, unchanged playhead, owned media cleanup");
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
