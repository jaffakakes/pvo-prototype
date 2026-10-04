import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Run against the Vite editor so the browser can import the source adapter.
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const { exportVideo } = await import("/src/infrastructure/media/exportVideo.ts");
    const recorders = [];
    let stoppedTracks = 0;
    let progressEvents = 0;
    let abortedAt = 0;
    const originalStart = MediaRecorder.prototype.start;
    const originalStop = MediaStreamTrack.prototype.stop;
    MediaRecorder.prototype.start = function (...args) {
      recorders.push(this);
      return originalStart.apply(this, args);
    };
    MediaStreamTrack.prototype.stop = function (...args) {
      stoppedTracks++;
      return originalStop.apply(this, args);
    };
    const controller = new AbortController();
    let errorName = null;
    try {
      await exportVideo({
        clips: [{ id: 1, url: null, color: "#445566", srcDur: 4, in: 0, out: 4,
          speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "contain" }],
        texts: [], components: [], layers: ["video"], muted: true, sound: 0,
        audioClips: [], ratio: "9:16", quality: "720p",
      }, fraction => {
        progressEvents++;
        if (fraction >= .03 && !controller.signal.aborted) {
          abortedAt = performance.now();
          controller.abort(new DOMException("Cancelled", "AbortError"));
        }
      }, controller.signal);
    } catch (error) {
      errorName = error.name;
    } finally {
      MediaRecorder.prototype.start = originalStart;
      MediaStreamTrack.prototype.stop = originalStop;
    }
    const cancelLatencyMs = performance.now() - abortedAt;
    const eventsAtCancel = progressEvents;
    await new Promise(resolve => setTimeout(resolve, 250));
    return { errorName, recorderStates: recorders.map(recorder => recorder.state),
      stoppedTracks, cancelLatencyMs, eventsAtCancel, eventsAfterCancel: progressEvents };
  });
  assert.equal(result.errorName, "AbortError");
  assert.deepEqual(result.recorderStates, ["inactive"], "the active MediaRecorder must stop");
  assert(result.stoppedTracks >= 1, "canvas capture tracks must stop");
  assert(result.cancelLatencyMs < 1000, "cancellation must not wait for the authored clip to finish");
  assert.equal(result.eventsAfterCancel, result.eventsAtCancel, "cancelled rendering must stop publishing progress");
  console.log(`Browser export cancellation passed: recorder and capture track stopped in ${Math.round(result.cancelLatencyMs)} ms.`);
} finally {
  await browser.close();
}
