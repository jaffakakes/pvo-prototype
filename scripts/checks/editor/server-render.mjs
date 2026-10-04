import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const capability = await fetch(new URL("/api/renders", origin)).then(async response =>
  response.headers.get("Content-Type")?.includes("application/json") ? response.json() : null).catch(() => null);
if (!capability?.available) {
  console.log("Server render browser check skipped: this editor origin has no render service.");
  process.exit(0);
}

const fixture = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const sourceBytes = await readFile(fixture);
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const metadata = path => JSON.parse(execFileSync(ffprobe, [
  "-v", "error", "-show_entries", "stream=codec_name,width,height",
  "-show_entries", "format=duration", "-of", "json", path,
], { encoding: "utf8" }));
const sourceDuration = Number(metadata(fixture).format.duration);
const downloads = await mkdtemp(join(tmpdir(), "restyle-server-render-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
let accountChecks = 0;
async function mockAccountSession(context) {
  await context.route(`${origin}/api/auth/session`, route => {
    accountChecks++;
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: { id: "local-render-check", name: "Local render check" } }) });
  });
}
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
  hasTouch: true, acceptDownloads: true });
await mockAccountSession(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const renderRequests = { create: [], uploads: [], starts: 0, results: 0, deletes: 0 };
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  const path = new URL(request.url()).pathname;
  if (path === "/api/renders" && request.method() === "POST")
    renderRequests.create.push(request.postDataJSON());
  if (/^\/api\/renders\/[^/]+\/sources\/[^/]+$/.test(path) && request.method() === "PUT")
    renderRequests.uploads.push({ path, contentLength: Number(request.headers()["content-length"]) });
  if (/^\/api\/renders\/[^/]+\/start$/.test(path) && request.method() === "POST") renderRequests.starts++;
  if (/^\/api\/renders\/[^/]+\/result$/.test(path) && request.method() === "GET") renderRequests.results++;
  if (/^\/api\/renders\/[^/]+$/.test(path) && request.method() === "DELETE") renderRequests.deletes++;
});

try {
  await page.addInitScript(() => {
    window.renderRecorderStarts = 0;
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) {
      window.renderRecorderStarts++;
      return start.apply(this, args);
    };
  });
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await page.locator(".editorWorkspace").waitFor();
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Flat video", exact: true }).click();
  const exportDialog = page.locator("dialog[data-state]");
  const quality = exportDialog.getByRole("radiogroup", { name: "Export quality" })
    .getByRole("radio", { name: /^1080p/ });
  await quality.click();
  assert.equal(await quality.getAttribute("aria-checked"), "true");
  await exportDialog.getByRole("button", { name: /Export video/ }).click();
  await page.locator('dialog[data-state="done"]').waitFor({ timeout: 180000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    exportDialog.getByRole("button", { name: /Download/ }).click(),
  ]);
  assert.equal(await download.failure(), null);
  const output = join(downloads, download.suggestedFilename());
  const downloaded = await readFile(await download.path());
  await writeFile(output, downloaded);
  assert.match(download.suggestedFilename(), /\.mp4$/, "The server result must download as MP4");
  const rendered = metadata(output);
  assert.equal(rendered.streams.find(stream => stream.width)?.codec_name, "h264");
  assert.equal(rendered.streams.find(stream => stream.width)?.width, 1080);
  assert.equal(rendered.streams.find(stream => stream.width)?.height, 1920);
  assert(Math.abs(Number(rendered.format.duration) - sourceDuration) < .09,
    `Server duration ${rendered.format.duration}s should match source ${sourceDuration}s within three frames`);
  assert.equal(await page.evaluate(() => window.renderRecorderStarts), 0, "server export must not record the canvas");
  assert.equal(renderRequests.create.length, 1);
  assert.equal(renderRequests.create[0].source.quality, "1080p");
  assert.equal(renderRequests.create[0].source.ratio, "9:16");
  assert.equal(renderRequests.create[0].source.clips[0].url, "asset_0");
  assert.equal(renderRequests.create[0].assets[0].bytes, sourceBytes.length);
  assert.equal(renderRequests.uploads.length, 1);
  assert(renderRequests.uploads[0].path.endsWith("/sources/asset_0"));
  if (renderRequests.uploads[0].contentLength)
    assert.equal(renderRequests.uploads[0].contentLength, sourceBytes.length);
  assert.equal(renderRequests.starts, 1);
  assert.equal(renderRequests.results, 1);
  assert(accountChecks > 0, "The editor must check the account before server rendering");
  await exportDialog.locator("[data-export-share]:visible").click();
  const share = page.getByRole("dialog", { name: "Share export", exact: true });
  await share.waitFor();
  await page.getByText("rendered on server", { exact: false }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(renderRequests.deletes, 1, "private sources and result must be deleted after download");
  assert.deepEqual(errors, []);

  const interactiveContext = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, acceptDownloads: true });
  await mockAccountSession(interactiveContext);
  try {
    const interactive = await interactiveContext.newPage();
    const interactiveErrors = [];
    const interactiveRequests = { creates: 0, results: 0 };
    interactive.on("pageerror", error => interactiveErrors.push(error.message));
    interactive.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/renders" && request.method() === "POST") interactiveRequests.creates++;
      if (/^\/api\/renders\/[^/]+\/result$/.test(path) && request.method() === "GET") interactiveRequests.results++;
    });
    await interactive.addInitScript(() => {
      window.renderRecorderStarts = 0;
      const start = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function (...args) {
        window.renderRecorderStarts++;
        return start.apply(this, args);
      };
    });
    await interactive.goto(editorUrl, { waitUntil: "networkidle" });
    const interactiveVisit = interactive.getByRole("button", { name: "Visit Site", exact: true });
    if (await interactiveVisit.isVisible()) await interactiveVisit.click();
    await interactive.locator('input[type="file"]').setInputFiles(fixture);
    await interactive.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
    await interactive.locator(".editorWorkspace").waitFor();
    await interactive.getByRole("button", { name: "Components", exact: true }).click();
    await interactive.getByRole("button", { name: /Add a note/ }).click();
    await interactive.getByRole("dialog", { name: "Note" }).getByRole("textbox", { name: "Text" }).fill("Server scene note");
    await interactive.getByRole("button", { name: "Done", exact: true }).click();
    await interactive.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
    await interactive.getByRole("dialog", { name: "More" })
      .getByRole("button", { name: "Interactive (.pvo)", exact: true }).click();
    const interactiveDialog = interactive.locator("dialog[data-state]");
    await interactiveDialog.getByRole("radiogroup", { name: "Export quality" })
      .getByRole("radio", { name: /^1080p/ }).click();
    await interactiveDialog.getByRole("button", { name: /Export \.pvo/ }).click();
    await interactive.locator('dialog[data-state="done"]').waitFor({ timeout: 180000 });
    const [pvoDownload] = await Promise.all([
      interactive.waitForEvent("download", { timeout: 15000 }),
      interactiveDialog.getByRole("button", { name: /Download/ }).click(),
    ]);
    assert.equal(await pvoDownload.failure(), null);
    assert.match(pvoDownload.suggestedFilename(), /\.pvo$/, "The interactive result must download as PVO");
    const decoded = await readPvoProject(new Blob([await readFile(await pvoDownload.path())]));
    assert.equal(decoded.validation.valid, true, JSON.stringify(decoded.validation.errors));
    const sceneAssetId = decoded.manifest.scenes[0]?.asset_id;
    const media = decoded.assets.find(asset => asset.id === sceneAssetId && asset.type === "video/mp4");
    assert(media, `interactive media should contain the server's MP4 scene result; assets=${JSON.stringify(decoded.assets.map(asset => ({ id: asset.id, type: asset.type })))}; requests=${JSON.stringify(interactiveRequests)}`);
    const mediaPath = join(downloads, "interactive-main.mp4");
    await writeFile(mediaPath, Buffer.from(await media.blob.arrayBuffer()));
    const mediaMetadata = metadata(mediaPath);
    assert.equal(mediaMetadata.streams.find(stream => stream.width)?.codec_name, "h264");
    assert.equal(mediaMetadata.streams.find(stream => stream.width)?.width, 1080);
    assert(Math.abs(Number(mediaMetadata.format.duration) - sourceDuration) < .09);
    assert.equal(interactiveRequests.creates, 1, "the PVO scene should use the server renderer");
    assert.equal(interactiveRequests.results, 1);
    assert.equal(await interactive.evaluate(() => window.renderRecorderStarts), 0);
    await interactiveDialog.locator("[data-export-share]:visible").click();
    await interactive.getByRole("dialog", { name: "Share export", exact: true })
      .getByText("rendered on server").waitFor();

    const viewer = await interactiveContext.newPage();
    await viewer.goto(new URL("../player/", editorUrl).href, { waitUntil: "networkidle" });
    await viewer.locator("#pvoInput").setInputFiles(await pvoDownload.path());
    await viewer.locator("#playerShell").waitFor({ state: "visible", timeout: 15000 });
    await viewer.waitForFunction(() => document.querySelector("#video")?.readyState >= 2);
    assert.equal(await viewer.locator("#video").evaluate(video => video.videoWidth), 1080);
    await viewer.locator("pvo-component-view").filter({ hasText: "Server scene note" }).waitFor({ state: "visible" });
    assert.deepEqual(interactiveErrors, []);
    console.log(`Server render passed: flat MP4 ${rendered.format.duration}s vs ${sourceDuration}s source; interactive PVO packages server MP4 and plays with its component. Files: ${output}, ${mediaPath}`);
  } finally {
    await interactiveContext.close();
  }
} catch (error) {
  console.error(`Server export UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1600)}`);
  throw error;
} finally {
  await browser.close();
}
