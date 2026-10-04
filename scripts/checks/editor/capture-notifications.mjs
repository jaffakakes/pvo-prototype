import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
});
const video = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
const page = await context.newPage();
page.setDefaultTimeout(10000);
try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles([
    { name: "valid.mp4", mimeType: "video/mp4", buffer: video },
    { name: "broken-one.mp4", mimeType: "video/mp4", buffer: Buffer.from("not video") },
    { name: "broken-two.mp4", mimeType: "video/mp4", buffer: Buffer.from("also not video") },
  ]);
  await page.locator('[data-notification-id="importFailed"]').waitFor();
  const recovery = page.getByRole("region", { name: "Capture recovery" });
  assert.match(await recovery.innerText(), /1 imported/);
  assert.match(await recovery.innerText(), /broken-one\.mp4/);
  assert.match(await recovery.innerText(), /broken-two\.mp4/);
  assert.equal(await page.locator("[data-notification-id]").count(), 1);
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  assert.equal(await recovery.isVisible(), true, "Banner dismissal must retain failed files and Retry");
  await recovery.getByRole("button", { name: "Retry failed files" }).click();
  await page.waitForFunction(async () => !(await import("/src/store.ts")).useCapture.getState().importing);
  assert.match(await recovery.innerText(), /1 imported/);
  await recovery.getByRole("button", { name: "Clear import results" }).click();
  assert.equal(await recovery.count(), 0);
  await page.waitForFunction(async () => {
    const { getProjectStorageStatus } = await import("/src/app/projectAutosave.ts");
    const status = getProjectStorageStatus();
    return status.storage.phase === "saved" && !status.storage.dirty;
  });

  // Fail one real IndexedDB open on reload. The old clip must remain recoverable.
  await page.evaluate(() => sessionStorage.setItem("fail-restore-once", "1"));
  await context.addInitScript(() => {
    if (sessionStorage.getItem("fail-restore-once") !== "1") return;
    sessionStorage.removeItem("fail-restore-once");
    const open = indexedDB.open.bind(indexedDB);
    let first = true;
    indexedDB.open = (...args) => {
      if (first) { first = false; throw new DOMException("Temporary storage denial", "InvalidStateError"); }
      return open(...args);
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  const restoreToast = page.locator('[data-notification-id="restoreFailed"]');
  await restoreToast.waitFor();
  await restoreToast.getByText("Couldn't restore your project.", { exact: true }).waitFor();
  const toastBounds = await restoreToast.boundingBox();
  assert(toastBounds && toastBounds.y >= 0 && toastBounds.y < 100 && toastBounds.height < 90,
    "Restore failure must use a compact top notification");
  assert.equal(await page.getByRole("region", { name: "Project storage", exact: true }).count(), 0,
    "Storage recovery details must not be pinned below the camera footer");
  assert.equal(await page.getByRole("button", { name: "Retry restore", exact: true }).count(), 0,
    "Recovery controls should appear only when requested");
  if (process.env.PVO_CAPTURE_NOTIFICATION_SCREENSHOT) {
    await restoreToast.evaluate(element => Promise.all(element.getAnimations()
      .map(animation => animation.finished.catch(() => {}))));
    await page.screenshot({ path: process.env.PVO_CAPTURE_NOTIFICATION_SCREENSHOT });
  }
  const cameraFooter = await page.locator(".camFoot").boundingBox();
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  assert.equal(await restoreToast.count(), 0);
  assert.equal(await page.getByRole("button", { name: "Restore issue", exact: true }).count(), 0,
    "Acknowledging the restore error must not replace it with a floating reminder");
  assert.equal(await page.getByRole("region", { name: "Project storage", exact: true }).count(), 0,
    "Dismissing the toast must not reveal a pinned storage panel");
  assert.deepEqual(await page.locator(".camFoot").boundingBox(), cameraFooter);

  await page.evaluate(() => sessionStorage.setItem("fail-restore-once", "1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Storage options", { exact: true }).waitFor();
  assert.equal(await restoreToast.count(), 0, "An acknowledged restore error must stay quiet after reload");
  assert.equal(await page.getByRole("button", { name: "Restore issue", exact: true }).count(), 0);

  await page.getByText("Storage options", { exact: true }).click();
  const storageRecovery = page.getByRole("region", { name: "Project storage", exact: true });
  await storageRecovery.getByRole("button", { name: "Retry restore", exact: true }).waitFor();
  assert(await storageRecovery.evaluate(element => !!element.closest("details")),
    "On-demand recovery must stay behind the camera storage control");
  await storageRecovery.getByRole("button", { name: "Retry restore", exact: true }).click();
  await page.getByRole("button", { name: "Open editor", exact: true }).waitFor();
  assert.equal(await restoreToast.count(), 0);
  assert.equal(await page.getByRole("button", { name: "Restore issue", exact: true }).count(), 0);
  const restored = await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().clips);
  assert.equal(restored.length, 1);
  assert(restored[0].url?.startsWith("blob:"), "Retry must restore the original video, not an empty project");

  await page.locator('input[type="file"]').setInputFiles({ name: "old-project.mp4", mimeType: "video/mp4", buffer: Buffer.from("broken") });
  await page.locator('[data-notification-id="importFailed"]').waitFor();
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.getByRole("dialog", { name: "Start over?", exact: true }).getByRole("button", { name: "Discard", exact: true }).click();
  assert.equal(await recovery.count(), 0, "Explicit project reset must release the previous import result");

  const captureContext = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ["camera", "microphone"] });
  try {
    await captureContext.addInitScript(() => {
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor() { throw new Error("Recorder startup fixture"); }
      };
    });
    const capture = await captureContext.newPage();
    await capture.goto(editorUrl, { waitUntil: "networkidle" });
    await capture.waitForFunction(() => document.querySelector("video.live")?.readyState >= 2);
    await capture.getByRole("button", { name: "Record", exact: true }).click();
    await capture.getByRole("button", { name: "Stop recording", exact: true }).click();
    await capture.locator('[data-notification-id="recordingFailed"]').waitFor();
    await capture.getByRole("button", { name: "Dismiss notification", exact: true }).click();
    const detail = capture.getByRole("region", { name: "Capture recovery" });
    assert.match(await detail.innerText(), /Clip 1/);
    assert.match(await detail.innerText(), /could not start/);
    await detail.getByRole("button", { name: "Record again", exact: true }).click();
    await capture.getByRole("button", { name: "Cancel replace", exact: true }).waitFor();
  } finally { await captureContext.close(); }
  console.log("Capture notifications passed: aggregate import failures, one-time storage toast, quiet reload, on-demand safe restore recovery and recording failure recovery.");
} finally {
  await context.close();
  await browser.close();
}
