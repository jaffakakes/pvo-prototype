import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";

async function cameraDetails(page) {
  return page.locator(".live").evaluate(video => {
    const stream = video.srcObject;
    const track = stream?.getVideoTracks()[0];
    return {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      videoId: track?.id,
      audioId: stream?.getAudioTracks()[0]?.id,
      settings: track?.getSettings(),
    };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  await page.addInitScript(() => {
    const NativeRecorder = window.MediaRecorder;
    window.recordingEncoders = [];
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream, options) {
        super(stream, options);
        window.recordingEncoders.push({ options, videoBitsPerSecond: this.videoBitsPerSecond, mimeType: this.mimeType });
      }
    };
  });
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".live")?.videoWidth >= 1920);
  const initial = await cameraDetails(page);
  assert.equal(initial.videoWidth, 1920, "The camera should request native HD footage");
  assert.equal(initial.videoHeight, 1080);
  assert.equal(initial.settings.resizeMode, "none", "The browser should not crop and upscale the camera stream");
  assert(initial.audioId, "The microphone must remain available with the HD camera");

  await page.getByRole("button", { name: "Ratio" }).click();
  await page.getByRole("menuitemradio", { name: "1:1" }).click();
  await page.locator('.cameraFrame[data-ratio="1:1"]').waitFor();
  assert.equal((await cameraDetails(page)).videoId, initial.videoId, "Changing the export crop must not degrade the native camera stream");

  await page.getByRole("button", { name: "Flip camera" }).click();
  await page.waitForFunction(oldId => {
    const video = document.querySelector(".live");
    return video?.videoWidth >= 1920 && video.srcObject?.getVideoTracks()[0]?.id !== oldId;
  }, initial.videoId);
  const flipped = await cameraDetails(page);
  assert.equal(flipped.audioId, initial.audioId, "Camera switching must retain the microphone track");
  assert.equal(flipped.settings.resizeMode, "none");

  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).waitFor();
  const recording = await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const clip = useCapture.getState().clips[0];
    const video = document.createElement("video");
    video.src = clip.url;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
    const source = { width: video.videoWidth, height: video.videoHeight };
    video.removeAttribute("src");
    video.load();
    return { source, encoder: window.recordingEncoders[0] };
  });
  assert.deepEqual(recording.source, { width: 1920, height: 1080 }, "The saved clip should retain HD source dimensions");
  assert(recording.encoder.options.videoBitsPerSecond >= 6_000_000, "HD recording needs an explicit bitrate above the browser default");
  assert.equal(recording.encoder.videoBitsPerSecond, recording.encoder.options.videoBitsPerSecond);
  await page.close();

  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  await fallback.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      if (constraints.video?.width) return Promise.reject(new DOMException("HD unavailable", "OverconstrainedError"));
      return native(constraints);
    };
  });
  await fallback.goto(editorUrl, { waitUntil: "networkidle" });
  await fallback.waitForFunction(() => document.querySelector(".live")?.videoWidth > 0);
  const recovered = await cameraDetails(fallback);
  assert.equal(recovered.videoWidth, 640, "Unsupported HD constraints should fall back to the camera default");
  assert.equal(recovered.videoHeight, 480);
  assert(recovered.audioId, "Fallback should preserve microphone capture");
  await fallback.close();

  console.log("HD camera capture, native ratio, retained microphone, bitrate, and fallback passed");
} finally {
  await browser.close();
}
