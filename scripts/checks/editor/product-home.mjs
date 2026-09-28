import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const expectedHash = createHash("sha256").update(await readFile(videoFile)).digest("hex");
const screenshots = await mkdtemp(join(tmpdir(), "restyle-product-home-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const errors = [];

async function savedCheckpoint(page, screen) {
  // Read the committed browser checkpoint, without importing or mutating app state.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async expectedScreen => {
      const opening = indexedDB.open("restyle-editor-project");
      const database = await new Promise((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        const request = database.transaction("checkpoints", "readonly").objectStore("checkpoints").get("current");
        const checkpoint = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return checkpoint?.resume.screen === expectedScreen && checkpoint.assetIds.length === 1
          && checkpoint.project.scenes[0].clips.length === 1;
      } finally { database.close(); }
    }, screen);
    if (ready) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`The ${screen} checkpoint with its imported media was not committed`);
}

async function assertFootage(page, selector) {
  const video = page.locator(selector).first();
  await video.waitFor({ state: "attached" });
  await page.waitForFunction(selector => document.querySelector(selector)?.readyState >= 2, selector);
  const hash = await video.evaluate(async element => {
    const response = await fetch(element.currentSrc || element.src);
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  });
  assert.equal(hash, expectedHash, "Navigating home must preserve the original imported footage");
}

async function run(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") console.error(`Browser: ${message.text()}`); });
  try {
    await page.goto(editorUrl, { waitUntil: "load" });
    const visit = page.getByRole("button", { name: "Visit Site", exact: true });
    if (await visit.isVisible()) await visit.click();
    await page.locator('input[type="file"]').setInputFiles(videoFile);
    await page.getByRole("button", { name: "Open editor", exact: true }).click();
    await page.locator(".editorWorkspace").waitFor();
    assert.equal(await page.locator(".tlClip").count(), 1);
    await assertFootage(page, ".tlClip video");
    await savedCheckpoint(page, "editor");

    await page.reload({ waitUntil: "load" });
    await page.locator(".editorWorkspace").waitFor();
    await assertFootage(page, ".tlClip video");
    assert.equal(await page.locator(".camWrap").count(), 0, "Direct editor reload must restore editing");

    const home = new URL(editorUrl);
    home.searchParams.set("home", "1");
    home.searchParams.set("acceptance", "preserved");
    await page.goto(home.href, { waitUntil: "load" });
    await page.locator("#root .app").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("home"), false, "Consume home intent so reload does not force the camera again");
    assert.equal(new URL(page.url()).searchParams.get("acceptance"), "preserved");
    if (mobile) {
      await page.locator(".camWrap").waitFor();
      assert.equal(await page.locator(".editorWorkspace").count(), 0);
      assert.equal(await page.locator(".dockCount").innerText(), "1");
      await assertFootage(page, ".dockThumb video");
      await savedCheckpoint(page, "camera");
      await page.screenshot({ path: join(screenshots, "mobile-home-saved-project.png"), fullPage: true });
      await page.getByRole("button", { name: "Open editor", exact: true }).click();
      await page.locator(".editorWorkspace").waitFor();
      assert.equal(await page.locator(".tlClip").count(), 1);
      await assertFootage(page, ".tlClip video");
      await savedCheckpoint(page, "editor");
      await page.reload({ waitUntil: "load" });
      await page.locator(".editorWorkspace").waitFor();
      await assertFootage(page, ".tlClip video");
    } else {
      await page.locator(".editorWorkspace").waitFor();
      assert.equal(await page.locator(".camWrap").count(), 0, "Desktop home must not force a restored editor into camera mode");
      await assertFootage(page, ".tlClip video");
    }
  } catch (error) {
    await page.screenshot({ path: join(screenshots, mobile ? "mobile-failure.png" : "desktop-failure.png"), fullPage: true }).catch(() => {});
    console.error(`Home UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1200)}\nScreenshots: ${screenshots}`);
    throw error;
  } finally { await context.close(); }
}

try {
  await run(true);
  assert.deepEqual(errors, []);
  console.log(`Product home passed: mobile camera entry after saved-draft recovery, original footage retained, Open editor, direct reload, desktop preservation. Screenshot: ${join(screenshots, "mobile-home-saved-project.png")}`);
} finally { await browser.close(); }
