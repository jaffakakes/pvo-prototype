import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadStudyMedia } from "./mediaFixture.mjs";
import { studyCases } from "./cases.mjs";
import { sha256 } from "./provenance.mjs";

const options = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
for (const key of Object.keys(options)) assert(["editor-url", "output"].includes(key), `Unknown option ${key}`);
const output = path.resolve(options.output ?? `/tmp/pvo-study-frame-preflight-${Date.now()}`);
await mkdir(output);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
});
const result = { startedAt: new Date().toISOString(), providerRequests: [], network: [], status: "FAIL" };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route(/\/(?:api\/assistant|__study)\/(?:turn|transcribe)(?:\?|$)/, route => {
    result.providerRequests.push(route.request().url());
    return route.abort();
  });
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/__study_media.mp4") result.network.push({
      status: response.status(), range: response.request().headers().range ?? null,
      contentRange: response.headers()["content-range"] ?? null,
    });
  });
  await page.goto(options["editor-url"] ?? "http://127.0.0.1:5196/", { waitUntil: "networkidle" });
  const definition = studyCases.find(test => test.id === "opening-multimodal");
  const media = await loadStudyMedia(page, definition.mediaPath);
  result.media = { ...media, sha256: sha256(await readFile(definition.mediaPath)) };
  result.inspections = await page.evaluate(async project => {
    const { inspectAssistantFrames } = await import("/src/infrastructure/assistant/media/frames.ts");
    const requests = [
      { kind: "frames", sceneId: "main", start: 0, end: 8, count: 4 },
      { kind: "frames", sceneId: "main", start: 65, end: 71, count: 6 },
    ];
    const createElement = document.createElement.bind(document);
    let presented = [];
    document.createElement = function (name, ...args) {
      const element = createElement(name, ...args);
      if (name === "video") {
        const original = element.requestVideoFrameCallback.bind(element);
        element.requestVideoFrameCallback = callback => original((now, metadata) => {
          presented.push({ sourceTime: metadata.mediaTime, currentTime: element.currentTime });
          callback(now, metadata);
        });
      }
      return element;
    };
    const sourceUrl = project.scenes[0].clips[0].url;
    const blobUrl = URL.createObjectURL(await (await fetch(sourceUrl)).blob());
    const inspections = [];
    try {
      for (const mode of ["range-http", "blob-control"]) {
        project.scenes[0].clips[0].url = mode === "range-http" ? sourceUrl : blobUrl;
        for (const request of requests) {
          presented = [];
          const started = performance.now();
          const observation = await inspectAssistantFrames(project, request);
          const frames = await Promise.all(observation.frames.map(async ({ dataUrl, ...frame }) => {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
            return { ...frame, imageSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
          }));
          inspections.push({ mode, request, durationMs: Math.round(performance.now() - started), frames, presented });
        }
      }
      return inspections;
    } finally {
      document.createElement = createElement;
      URL.revokeObjectURL(blobUrl);
    }
  }, definition.fixture(media));
  assert.equal(result.providerRequests.length, 0, "Frame preflight must not issue inference requests");
  assert(result.network.some(response => response.status === 206 && response.contentRange), "Browser must receive a real partial-content response");
  for (let index = 0; index < 2; index += 1) {
    const http = result.inspections[index], blob = result.inspections[index + 2];
    const expected = index === 0 ? [1, 3, 5, 7] : [65.5, 66.5, 67.5, 68.5, 69.5, 70.5];
    assert.deepEqual(http.frames.map(frame => frame.sourceTime), expected);
    assert.deepEqual(http.frames, blob.frames, "Seekable HTTP and blob must render identical actual pixels");
    assert.equal(http.presented.length, expected.length);
    for (const [frameIndex, frame] of http.presented.entries()) {
      assert(Math.abs(frame.sourceTime - expected[frameIndex]) < 0.05, "Decoded presentation must match the requested source time");
      assert(Math.abs(frame.currentTime - expected[frameIndex]) < 0.05, "Seek must reach the requested source time");
    }
  }
  result.status = "PASS";
} catch (error) {
  result.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await browser.close();
  result.endedAt = new Date().toISOString();
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ status: result.status, output, providerRequests: result.providerRequests.length, error: result.error }));
