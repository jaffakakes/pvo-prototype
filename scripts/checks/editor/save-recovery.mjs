import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.EDITOR_URL || "http://127.0.0.1:4173/editor/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const media = new URL("../../../share/assets/preview.mp4", import.meta.url)
  .pathname;
async function checkpoint(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("restyle-editor-project", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction("checkpoints")
          .objectStore("checkpoints")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
async function saved(page) {
  await page.getByText(/^Saved in this browser(?: ·.*)?$/).waitFor();
}
try {
  for (const [width, height, theme] of [
    [430, 932, "dark"],
    [320, 568, "light"],
    [1280, 800, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator('input[type="file"]').first().setInputFiles(media);
    await page
      .getByRole("button", { name: /^(Open editor|Start editing)$/ })
      .click();
    await saved(page);
    // Camera starts an anonymous draft; reopening assigns its durable project identity.
    await page.waitForTimeout(1100);
    await page.reload();
    await saved(page);
    await page.waitForTimeout(1100);
    const existing = (await checkpoint(page)).find((item) => item.localId);
    assert(existing?.assetIds.length, "Fixture must have saved real media");
    const missing = new URL(base);
    missing.searchParams.set("project", "absent-project");
    await page.goto(missing.href);
    await page.locator('[data-notification-id="projectMissing"]').waitFor();
    assert.equal(
      new URL(page.url()).searchParams.has("project"),
      false,
      "Clear the missing route",
    );
    assert.equal(
      await page.getByText("Storage options", { exact: true }).count(),
      0,
    );
    assert.deepEqual(
      await checkpoint(page),
      [existing, existing],
      "An empty missing route must not overwrite the current or named checkpoint",
    );
    await page.locator('input[type="file"]').first().setInputFiles(media);
    await page
      .getByRole("button", { name: /^(Open editor|Start editing)$/ })
      .click();
    await saved(page);
    const title = page.getByRole("textbox", {
      name: width >= 1024 ? /^Name/ : "Project title",
      exact: true,
    });
    await page.evaluate(() => {
      window.failSaveFixture = true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.failSaveFixture && this.name === "checkpoints")
          throw new DOMException("Fixture quota denial", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await title.fill("Keep my latest edit");
    await title.press("Enter");
    const failure = page.locator('[data-notification-id="saveFailed"]');
    await failure.waitFor();
    await failure.evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const box = await failure.boundingBox();
    assert(
      box.y > height - 100 &&
        box.y + box.height <= height &&
        box.x >= 0 &&
        box.x + box.width <= width,
      JSON.stringify(box),
    );
    await page.screenshot({
      path: `/private/tmp/restyle-save-notice-${width}.png`,
    });
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Saving paused", exact: true })
      .click();
    const detail = page.getByRole("region", {
      name: "Project storage",
      exact: true,
    });
    await detail.waitFor();
    await page.evaluate(() => {
      window.failSaveFixture = false;
    });
    await detail
      .getByRole("button", { name: "Retry save", exact: true })
      .click();
    await saved(page);
    assert.equal(await detail.count(), 0);
    const kept = (await checkpoint(page)).find(
      (item) => item.localId === existing.localId,
    );
    assert.deepEqual(
      kept,
      existing,
      "Saving new work retains the unrelated project's media references",
    );
    await page.reload();
    await saved(page);
    assert.equal(await title.inputValue(), "Keep my latest edit");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}×${height}: missing link, retained checkpoint/media, save failure, bottom notice, dismiss/retry and reload passed`,
    );
  }
} finally {
  await browser.close();
}
