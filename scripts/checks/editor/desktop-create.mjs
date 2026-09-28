import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const videoBytes = await readFile(videoFile);
const screenshots = await mkdtemp(join(tmpdir(), "restyle-create-project-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const errors = [];
const desktop = page => page.locator("[data-desktop-editor]");
const clips = page => page.locator("[data-desktop-timeline]").getByRole("button", { name: /^Clip \d+,/ });

async function saved(page, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async projectId => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise((resolve, reject) => {
        const request = database.transaction("checkpoints").objectStore("checkpoints").get(`project:${projectId}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return record?.localId === projectId;
    } finally { database.close(); }
    }, id);
    if (ready) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`Project ${id} was not saved`);
}

async function run(width) {
  const height = width === 1024 ? 768 : 900;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 1024 });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.route("**/api/publishing", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, authenticated: false, maxBytes: 0 }) }));
  try {
    const home = new URL(editorUrl);
    home.search = "?home=1";
    await page.goto(home.href);
    await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Resume", exact: false }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Start editing", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(screenshots, `create-${width}.png`) });
    await page.getByLabel("Upload video files").setInputFiles(videoFile);
    await page.getByLabel("Project name", { exact: true }).fill("My first edit");
    await page.getByRole("radio", { name: "4:5", exact: true }).check();
    await page.getByRole("button", { name: "Start editing", exact: true }).click();
    await desktop(page).waitFor();
    const firstUrl = page.url();
    const firstId = new URL(firstUrl).searchParams.get("project");
    assert.ok(firstId);
    assert.equal(await clips(page).count(), 1);
    await saved(page, firstId);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Export to device" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(page.url(), firstUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(page.url(), firstUrl, "Resizing must never change project routes");
    await page.getByRole("button", { name: "Back to camera" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Export", exact: true }).count(), 0, "Phone keeps its original header");
    await page.setViewportSize({ width: 1024, height: 1200 });
    await page.getByRole("button", { name: "Back to camera" }).waitFor();
    assert.equal(await desktop(page).count(), 0, "Portrait keeps the existing editor");
    assert.equal(page.url(), firstUrl, "Changing orientation must retain the project route");
    await page.setViewportSize({ width, height });
    await page.reload();
    await desktop(page).waitFor();
    await page.getByRole("heading", { name: "My first edit", exact: true }).waitFor();
    assert.equal(await clips(page).count(), 1);
    const restoredBytes = await clips(page).first().locator("video").evaluate(async video => Array.from(new Uint8Array(await (await fetch(video.src)).arrayBuffer())));
    assert.deepEqual(Buffer.from(restoredBytes), videoBytes, "Recovery must retain the exact media bytes");
    await page.getByRole("button", { name: "Back to projects" }).click();
    await page.getByRole("button", { name: "Resume", exact: false }).waitFor();
    await page.getByRole("button", { name: "Blank project", exact: true }).click();
    await desktop(page).waitFor();
    const secondId = new URL(page.url()).searchParams.get("project");
    assert.notEqual(firstId, secondId);
    assert.equal(await clips(page).count(), 0);
    await saved(page, secondId);
    await page.goBack();
    await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "My first edit", exact: true }).waitFor();
    assert.equal(await clips(page).count(), 1, "New projects must not delete older footage");
    await page.getByRole("button", { name: "Back to projects" }).click();
    await page.getByRole("button", { name: "Use Choose your path template" }).click();
    await page.getByRole("heading", { name: "Choose your path", exact: true }).waitFor();
    assert.equal(await clips(page).count(), 1);
    await page.getByRole("tab", { name: "Components", exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `editor-${width}.png`) });
  } catch (error) {
    await page.screenshot({ path: join(screenshots, `failure-${width}.png`) }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(0, 1500));
    throw error;
  } finally { await context.close(); }
}

async function dropVariant() {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const url = new URL(editorUrl);
  url.search = "?home=1&drop";
  await page.goto(url.href);
  await page.getByRole("heading", { name: "Drop clips to start editing" }).waitFor();
  const transfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "dropped-video.mp4", { type: "video/mp4" }));
    return transfer;
  }, Array.from(videoBytes));
  await page.locator("header").dispatchEvent("drop", { dataTransfer: transfer });
  await page.getByRole("heading", { name: "Clips are in — set up your edit" }).waitFor();
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "dropped video");
  await page.getByRole("radio", { name: "1:1", exact: true }).check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await desktop(page).waitFor();
  assert.equal(await clips(page).count(), 1);
  assert.match(await page.getByRole("button", { name: "Project settings" }).innerText(), /1:1/);
  await context.close();
}

async function stagedResize() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  const url = new URL(editorUrl);
  url.search = "?home=1&template=podcast-clip";
  await page.goto(url.href);
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "Podcast clip");
  await page.getByLabel("Upload video files").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not video") });
  await page.getByRole("alert").filter({ hasText: "isn't a supported video" }).waitFor();
  await page.getByLabel("Upload video files").setInputFiles(videoFile);
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".camWrap").waitFor();
  assert.equal(await page.getByRole("heading", { name: "Start a new edit" }).count(), 0);
  assert.equal(page.url(), url.href);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("heading", { name: "Start a new edit" }).waitFor();
  assert.equal(await page.getByLabel("Project name", { exact: true }).inputValue(), "Podcast clip");
  await page.getByText("Clips are ready", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await desktop(page).waitFor();
  assert.equal(await clips(page).count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.waitForURL(current => !current.searchParams.has("project"));
  await page.reload();
  await page.locator(".camWrap").waitFor();
  assert.equal(await page.getByRole("button", { name: "Open editor", exact: true }).count(), 0, "Discarded project must not return after reload");
  await context.close();
}

try {
  for (const width of [1024, 1280, 1440]) await run(width);
  await dropVariant();
  await stagedResize();
  assert.deepEqual(errors, []);
  console.log(`Responsive create passed: 1024/1280/1440 landscape plus existing phone/portrait editor, upload, ratio, auth dismissal, stable routes, saved media, multiple projects, templates and page-wide drop-ready strip. Screenshots: ${screenshots}`);
} finally { await browser.close(); }
