import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const sentinel = "Export diagnostic sentinel: canvas capture unavailable for this attempt.";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true,
  acceptDownloads: true });
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

const sheet = page.locator("dialog[data-state]");
const notice = page.locator('[data-notification-id="exportFailed"]');
async function openExport() {
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Flat video" }).click();
}

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
  await page.locator('dialog[data-state="failed"]').waitFor();
  await sheet.getByText(sentinel, { exact: true }).waitFor();
  assert.equal(await sheet.getByRole("button", { name: "Copy details", includeHidden: true }).count(), 1,
    "The failure should retain a copyable diagnostic on larger screens");
  await sheet.getByRole("button", { name: "Retry", exact: true }).waitFor();
}

try {
  await page.route("**/api/auth/session", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: { id: "notification-check", name: "Notification check" } }) }));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)));
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await openExport();
  assert.equal(await page.locator("[data-notification-id]").count(), 0, "Import and opening Export need no confirmation");
  await sheet.getByRole("button", { name: /Export video/ }).click();
  await assertExportFailure();
  const firstNoticeAt = Date.now();
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 1);
  await sheet.getByRole("button", { name: "Close export" }).click();
  await notice.waitFor({ state: "detached" });

  await openExport();
  assert.equal(await sheet.getByText(sentinel, { exact: true }).count(), 0,
    "A closed export attempt cannot leave stale diagnostics");
  // Respect the production brief-message cooldown before a separate failed attempt.
  await page.waitForTimeout(Math.max(0, 10100 - (Date.now() - firstNoticeAt)));
  await sheet.getByRole("button", { name: /Export video/ }).click();
  await assertExportFailure();
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 2);

  await page.evaluate(() => { exportCaptureFixture.fail = false; });
  await sheet.getByRole("button", { name: "Retry", exact: true }).click();
  await notice.waitFor({ state: "detached" });
  await page.locator('dialog[data-state="done"]').waitFor({ timeout: 45000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    sheet.getByRole("button", { name: /Download/ }).click(),
  ]);
  assert.match(download.suggestedFilename(), /\.(mp4|webm)$/);
  assert.equal(await page.evaluate(() => exportCaptureFixture.calls), 3, "Retry must execute the exporter again");
  assert.equal(await sheet.getByText(sentinel, { exact: true }).count(), 0,
    "Successful retry clears prior diagnostics");
  assert.equal(await page.locator("[data-notification-id]").count(), 0, "Visible completion needs no success toast");
  assert.deepEqual(errors, []);
  console.log("Export notifications passed: actual capability failure, concise top message, visible details, close cleanup, successful retry and quiet completion.");
} finally {
  await context.close();
  await browser.close();
}
