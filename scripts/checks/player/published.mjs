import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { playerSourceAssets } from "../helpers/player-assets.mjs";
import { packPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";

const assets = await playerSourceAssets();
const screenshots = process.env.PVO_PLAYER_ARTIFACTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const template = await readFile(new URL("../../../player/published.html", import.meta.url), "utf8");
const video = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const manifest = {
  spec_version: PVO_SPEC_VERSION, initial_scene: "main", canvas: { ratio: "9:16", width: 9, height: 16 },
  restyle_capture: { version: 1 },
  media: [{ id: "media", asset_id: "video", name: "media/video.mp4", type: "video/mp4" }],
  scenes: [{ id: "main", label: "Published", asset_id: "video", start: 0, end: 2 }],
  playback: { initial_timeline: "main", timelines: [{ id: "main", kind: "main",
    clips: [{ id: "clip", scene: "main", asset_id: "video", start: 0, end: 2 }] }] },
  components: [{ id: "note", kind: "tooltip", text: "Published PVO",
    presentation: { scene: "main", start: 0, end: 2, x: .2, y: .2, width: .5, height: .1 },
    restyle_capture: { version: 1, at: 0, dur: 2, x: 50, y: 30 } }],
};
const pvo = Buffer.from(await (await packPvoProject({ manifest,
  assets: [{ id: "video", name: "media/video.mp4", blob: new Blob([video], { type: "video/mp4" }) }],
})).arrayBuffer());
const ids = { video: "native_video_123456", pvo: "interactive_1234567", failed: "failed_video_123456" };
const mediaRequests = [];
let origin;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  const id = path.startsWith("/player/") ? path.slice(8) : "";
  if (Object.values(ids).includes(id)) {
    const format = id === ids.pvo ? "pvo" : "video";
    const values = { TITLE: "Published video", CANONICAL_URL: `${origin}/player/${id}`,
      PUBLICATION_ID: id, FORMAT: format, MEDIA_URL: `/media/${id}`, POSTER_URL: "", POSTER_META: "",
      CONTENT_TYPE: format === "pvo" ? "application/vnd.pvo" : "video/mp4" };
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key]));
    return;
  }
  let asset = assets.get(path);
  if (path === `/media/${ids.video}`) asset = { body: video, type: "video/mp4" };
  if (path === `/media/${ids.pvo}`) asset = { body: pvo, type: "application/vnd.pvo" };
  if (path.startsWith("/media/")) mediaRequests.push({ path, cookie: request.headers.cookie });
  if (!asset) { response.writeHead(404).end("Unavailable"); return; }
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (range && asset.type.startsWith("video/")) {
    const start = Number(range[1]);
    const end = Math.min(Number(range[2] || asset.body.length - 1), asset.body.length - 1);
    response.writeHead(206, { "content-type": asset.type, "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${asset.body.length}`, "content-length": end - start + 1 });
    response.end(asset.body.subarray(start, end + 1));
    return;
  }
  response.writeHead(200, { "content-type": asset.type, "content-length": asset.body.length, "cache-control": "no-store" });
  response.end(asset.body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "creator-session", value: "not-for-packages", url: origin }]);
  await context.addInitScript(() => {
    window.copiedLinks = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async value => { window.copiedLinks.push(value); } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/player/${ids.video}?src=/wrong.pvo#time`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#video").readyState >= 1);
  assert.equal(await page.locator("#video").evaluate(element => element.controls), false);
  assert.equal(await page.locator("#playerControls, #progress, #volumeControl").count(), 0);
  assert.equal(await page.locator("#overlayLayer").locator(".component-position").count(), 0);
  await page.locator("#video").evaluate(async element => { await element.play(); });
  await page.waitForFunction(() => document.querySelector("#video").currentTime > .1);
  await page.locator("#video").evaluate(element => { element.pause(); element.currentTime = 1; });
  await page.waitForFunction(() => Math.abs(document.querySelector("#video").currentTime - 1) < .05);
  await page.locator("#centerPlayButton").waitFor({ state: "visible" });
  if (screenshots) {
    await page.screenshot({ path: join(screenshots, "light-phone-published-paused.png"), animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: join(screenshots, "dark-phone-published-paused.png"), animations: "disabled" });
  }
  await page.locator("[data-player-share]:visible").click();
  assert.deepEqual(await page.evaluate(() => window.copiedLinks), [`${origin}/player/${ids.video}`]);
  assert.equal(await page.getByRole("link", { name: "Create a video", exact: true }).first().getAttribute("href"), "/");
  assert.equal(await page.locator('a[href*="docs"],a[href*="demo"]').count(), 0);

  await page.goto(`${origin}/player/${ids.pvo}?src=/wrong.pvo`, { waitUntil: "networkidle" });
  await page.locator('#video[data-asset-id="video"]').waitFor();
  await page.locator("pvo-component-view").getByText("Published PVO", { exact: true }).waitFor();
  assert.equal(await page.locator("#video").evaluate(element => element.controls), false);
  assert.equal(await page.locator("#statusWidget").isVisible(), true);
  assert.equal(mediaRequests.find(request => request.path === `/media/${ids.pvo}`)?.cookie, undefined);
  await page.locator("[data-player-share]:visible").click();
  assert.deepEqual(await page.evaluate(() => window.copiedLinks), [`${origin}/player/${ids.pvo}`]);
  if (await page.locator("#video").evaluate(element => element.paused)) {
    await page.locator("#centerPlayButton").click();
  }
  await page.waitForFunction(() => document.querySelector("#video").currentTime > .1);

  await page.goto(`${origin}/player/`, { waitUntil: "networkidle" });
  await page.locator("#pvoInput").setInputFiles({ name: "local.pvo", mimeType: "application/vnd.pvo", buffer: pvo });
  await page.locator('#video[data-asset-id="video"]').waitFor();
  assert.equal(await page.locator("[data-player-share]:visible").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.copiedLinks), []);

  await page.goto(`${origin}/player/${ids.failed}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Video unavailable" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Try again" }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("Published player passed: shared video chrome/playback, PVO overlays/playback, canonical sharing, credential-free package fetch, local files unshareable, and unavailable-media recovery.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
