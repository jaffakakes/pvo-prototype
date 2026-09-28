import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const sentinel = "Export diagnostic sentinel: canvas capture unavailable for this attempt.";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(10000);

// Fail only a browser capability; the UI, exporter, catch and notification stay real.
await context.addInitScript(message => {
  const captureStream = HTMLCanvasElement.prototype.captureStream;
  const fixture = { calls: 0, fail: true };
  window.exportCaptureFixture = fixture;
  HTMLCanvasElement.prototype.captureStream = function (...args) {
    fixture.calls++;
    if (fixture.fail) throw new Error(message);
    return captureStream.apply(this, args);
  };
}, sentinel);

const sheet = page.getByRole("dialog", { name: "Export", exact: true });
const notice = page.locator('[data-notification-id="exportFailed"]');

async function assertExportFailure() {
  await notice.waitFor();
  await notice.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  assert.equal(await notice.getAttribute("data-severity"), "error");
  assert.equal(await notice.getByText("Export failed. Try again.", { exact: true }).count(), 1);
  assert.equal(await notice.getByText(sentinel, { exact: true }).count(), 0, "Raw details must not enter the banner");
  assert.equal(await sheet.getByText("Export failed. Try again.", { exact: true }).count(), 0,
    "The sheet must not duplicate the notification sentence");
  const app = await page.locator(".app").boundingBox();
  const banner = await notice.boundingBox();
  assert(app && banner && banner.y >= app.y && banner.y + banner.height <= app.y + 100,
    "Export failure must appear in the compact top notification area");
  const details = sheet.locator("details");
  assert.equal(await details.getAttribute("open"), null, "Failure details start collapsed");
  assert.equal(await details.getByText(sentinel, { exact: true }).isVisible(), false);
  await details.locator("summary").click();
  await details.getByText(sentinel, { exact: true }).waitFor();
  await details.locator("summary").click();
  await sheet.getByRole("button", { name: "Retry export", exact: true }).waitFor();
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)));
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await page.locator("[data-notification-id]").count(), 0, "Import and opening Export need no confirmation");
  await sheet.getByRole("button", { name: "Export video", exact: true }).click();
  await assertExportFailure();
  const firstNoticeAt = Date.now();
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 1);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await notice.waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await sheet.locator("details").count(), 0, "A closed export attempt cannot leave stale diagnostics");
  // Respect the production brief-message cooldown before a separate failed attempt.
  await page.waitForTimeout(Math.max(0, 10100 - (Date.now() - firstNoticeAt)));
  await sheet.getByRole("button", { name: "Export video", exact: true }).click();
  await assertExportFailure();
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 2);

  await page.evaluate(() => { exportCaptureFixture.fail = false; });
  const download = page.waitForEvent("download", { timeout: 30000 });
  await sheet.getByRole("button", { name: "Retry export", exact: true }).click();
  await notice.waitFor({ state: "detached" });
  await sheet.getByText("Ready to download", { exact: true }).waitFor({ timeout: 30000 });
  assert.match((await download).suggestedFilename(), /^restyle-video\.(mp4|webm)$/);
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 3, "Retry must execute the exporter again");
  assert.equal(await sheet.locator("details").count(), 0, "Successful retry clears prior diagnostics");
  assert.equal(await page.locator("[data-notification-id]").count(), 0, "Visible completion needs no success toast");
  assert.deepEqual(errors, []);
  console.log("Export notifications passed: actual capability failure, concise top message, collapsed details, close cleanup, successful retry and quiet completion.");
} finally {
  await context.close();
  await browser.close();
}
