import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const media = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
let metadataGate = null;

function holdMetadata() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  metadataGate = promise;
  return () => {
    if (metadataGate === promise) metadataGate = null;
    release();
  };
}

async function renderWhileLoading() {
  await page.locator(".pvVideo").waitFor();
  await page.evaluate(async () => {
    window.capture.getState().patch({ ratioMenu: !window.capture.getState().ratioMenu });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.querySelector(".pvVideo").readyState !== HTMLMediaElement.HAVE_NOTHING)
      throw new Error("The media fixture must still be waiting for metadata during the extra render");
  });
}

async function decodedSnapshot() {
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.seeking) return false;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let visiblePixels = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) visiblePixels++;
    return visiblePixels > 100;
  });
  return page.evaluate(() => {
    const video = document.querySelector(".pvVideo");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let visiblePixels = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) visiblePixels++;
    const bounds = video.getBoundingClientRect();
    return {
      time: video.currentTime, stateTime: window.capture.getState().t, paused: video.paused,
      seekableEnd: video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0,
      visiblePixels, width: bounds.width, height: bounds.height,
    };
  });
}

async function assertPausedFrame(time, label) {
  const snapshot = await decodedSnapshot();
  assert(snapshot.seekableEnd > time, `${label}: the real media fixture must support seeking`);
  assert(Math.abs(snapshot.time - time) < .03,
    `${label}: the visible decoder lost the paused playhead: ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.stateTime, time, `${label}: switching views must retain the playhead`);
  assert.equal(snapshot.paused, true);
  assert(snapshot.visiblePixels > 100, `${label}: a decoded picture must be present, not just audio metadata`);
  assert(snapshot.width > 100 && snapshot.height > 100, `${label}: the video must remain visible in the layout`);
}

try {
  // Range replies matter: a plain mocked 200 can leave Chrome's seekable range at
  // [0, 0], which would test a broken media server instead of the preview lifecycle.
  await page.route("**/playback-view-switch.mp4", async route => {
    if (metadataGate) await metadataGate;
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const start = Number(range?.[1] ?? 0);
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    await route.fulfill({
      status: range ? 206 : 200, contentType: "video/mp4",
      headers: {
        "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Length": String(end - start + 1),
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}),
      },
      body: media.subarray(start, end + 1),
    });
  });
  await page.goto(editorUrl);
  await page.locator("#restyle-launch-splash").waitFor({ state: "hidden" });
  let release = holdMetadata();
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    window.capture = useCapture;
    const clips = [mkClip(7, new URL("/playback-view-switch.mp4", location.href).href, 0)];
    const main = { id: "main", parent: null, name: "Video", clips, texts: [], components: [],
      audioClips: [], layers: ["video"], muted: true, sound: -1 };
    const empty = { ...main, id: "empty", parent: "main", name: "Empty", clips: [] };
    // HTTP media is intentional in this isolated fixture so its metadata can be
    // gated. Project persistence rejects non-blob URLs; saving is outside this check.
    useCapture.setState({
      scenes: [main, empty], currentSceneId: "main", clips, texts: [], components: [], audioClips: [],
      layers: ["video"], muted: true, sound: -1, screen: "editor", sheet: null,
      sel: -1, selComp: null, selText: null, t: 2, playing: false, tryMode: null, past: [], future: [],
    });
  });
  await renderWhileLoading();
  release();
  await assertPausedFrame(2, "Initial paused preview");

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.evaluate(() => { window.previousVideo = document.querySelector(".pvVideo"); });
    release = holdMetadata();
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => document.querySelector(".pvVideo") !== window.previousVideo);
    await renderWhileLoading();
    release();
    await assertPausedFrame(2, `Paused view ${viewport.width} × ${viewport.height}`);
    assert.equal(await page.evaluate(() => window.previousVideo.paused), true);
  }

  await page.evaluate(() => window.capture.getState().patch({ t: .5, ratioMenu: false }));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pvVideo").currentTime > .7);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const before = await page.evaluate(() => {
      window.previousVideo = document.querySelector(".pvVideo");
      return window.capture.getState().t;
    });
    await page.setViewportSize(viewport);
    await page.waitForFunction(previousTime => {
      const video = document.querySelector(".pvVideo");
      return video !== window.previousVideo && !video.paused && !video.seeking && video.currentTime > previousTime + .15;
    }, before);
    const snapshot = await decodedSnapshot();
    assert(Math.abs(snapshot.time - snapshot.stateTime) < .15, "The new decoder and playhead must advance together");
    assert(snapshot.visiblePixels > 100, "Playing view switches must retain decoded video frames");
    assert.equal(await page.evaluate(() => window.previousVideo.paused), true, "The old decoder must stop");
  }

  await page.evaluate(() => {
    window.previousVideo = document.querySelector(".pvVideo");
    window.capture.getState().switchScene("empty");
  });
  await page.locator(".pvVideo").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.previousVideo.paused), true, "A source-less scene must stop the removed decoder");
  await page.evaluate(() => {
    window.capture.getState().switchScene("main");
    window.capture.getState().patch({ t: 2 });
  });
  await assertPausedFrame(2, "Return from source-less scene");
  assert.deepEqual(errors, []);
  console.log("PASS: delayed metadata retains paused frames; desktop/mobile playback, decoder cleanup and scene return.");
} finally {
  await browser.close();
}
