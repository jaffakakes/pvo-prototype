import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const url = process.env.EDITOR_URL || "http://127.0.0.1:4173/editor/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const fixture = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const screenshotDir = process.env.SCREENSHOT_DIR || "/private/tmp";
try {
  for (const [width, height, theme] of [
    [430, 932, "dark"],
    [320, 568, "light"],
    [1280, 800, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page
      .getByRole("button", {
        name: /^(Open editor|Start editing)$/,
        exact: true,
      })
      .click();
    const tile = page.getByRole("button", { name: "Edit cover", exact: true });
    await tile.waitFor();
    await tile.locator("img").waitFor();
    await page.waitForTimeout(400);
    const tileBox = await tile.boundingBox();
    assert(tileBox.width >= 44 && tileBox.height >= 44);
    if (width < 768) {
      const head = await page
        .getByRole("slider", { name: "Timeline playhead" })
        .boundingBox();
      assert(
        tileBox.x + tileBox.width < head.x + head.width / 2,
        "Cover sits before the clip/playhead",
      );
    }
    await page.screenshot({
      path: `${screenshotDir}/restyle-cover-tile-${width}.png`,
    });
    await tile.click();
    const dialog = page.getByRole("dialog", {
      name: "Choose cover",
      exact: true,
    });
    const range = dialog.getByRole("slider", { name: "Pick a cover frame" });
    await range.waitFor();
    assert.equal(Number(await range.inputValue()), 0);
    assert.equal(await dialog.getByRole("button").count(), 2);
    const box = await range.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    const picked = Number(await range.inputValue());
    assert(picked > 1);
    await page.waitForFunction((time) => {
      const video = document.querySelector("[data-cover-only] video");
      return (
        video?.readyState >= 2 &&
        !video.seeking &&
        Math.abs(video.currentTime - time) < 0.08
      );
    }, picked);
    await page.screenshot({
      path: `${screenshotDir}/restyle-cover-picker-${width}.png`,
    });
    await dialog.getByRole("button", { name: "Close cover picker" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert(await tile.evaluate((el) => el === document.activeElement));
    await tile.click();
    assert.equal(
      Number(await range.inputValue()),
      0,
      "Closing discards the draft",
    );
    await range.focus();
    await range.press("End");
    await range.press("ArrowLeft");
    const saved = Number(await range.inputValue());
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await tile.click();
    assert(Math.abs(Number(await range.inputValue()) - saved) < 0.02);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "networkidle" });
    await tile.click();
    assert(
      Math.abs(Number(await range.inputValue()) - saved) < 0.02,
      "Saved cover survives reload",
    );
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    console.log(
      `${width}×${height} ${theme}: tile, live scrubbing, cancellation, Save, Escape, focus and reload passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
