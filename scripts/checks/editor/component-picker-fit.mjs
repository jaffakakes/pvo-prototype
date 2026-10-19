import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
try {
  for (const [width, height, theme, fits, insets] of [
    [360, 800, "light", true],
    [390, 844, "light", true],
    [390, 844, "dark", true, { top: 47, bottom: 34, left: 0, right: 0 }],
    [430, 932, "light", true, { top: 59, bottom: 34, left: 0, right: 0 }],
    [375, 667, "light", false],
    [320, 568, "light", false],
    [844, 390, "dark", false],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      hasTouch: true,
      isMobile: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { settle, geometry, assertDocked } = createSheetDockChecks(page);
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      if (insets)
        await (
          await context.newCDPSession(page)
        ).send("Emulation.setSafeAreaInsetsOverride", { insets });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      await settle();
      const original = await geometry();
      await page
        .getByRole("button", { name: "Components", exact: true })
        .click();
      const picker = page.getByRole("dialog", {
        name: "Add a component",
        exact: true,
      });
      await assertDocked(
        picker,
        original.preview.width / original.preview.height,
      );
      const body = picker.locator("[data-sheet-body]");
      const overflow = await body.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      );
      const tiles = picker.locator(".componentTypeTile");
      assert.equal(await tiles.count(), 4);
      assert.equal(await picker.locator(".sheetHead").count(), 0);
      const firstChoice = await tiles.first().boundingBox();
      const pickerBox = await picker.boundingBox();
      assert(
        firstChoice.y - pickerBox.y <= 12,
        "Choices start at the top without an empty header row",
      );
      const close = page.getByRole("button", {
        name: "Close components",
        exact: true,
      });
      const closeBox = await close.boundingBox();
      assert(
        closeBox.width >= 44 &&
          closeBox.height >= 44 &&
          closeBox.y + closeBox.height <= pickerBox.y,
      );
      assert.equal(await body.evaluate((element) => element.scrollTop), 0);
      if (fits) {
        assert(
          overflow <= 1,
          `${width} × ${height}: all choices fit without scrolling (${overflow}px overflow)`,
        );
        for (const tile of await tiles.all()) {
          const box = await tile.boundingBox();
          assert(box.width >= 44 && box.height >= 44);
          assert(
            box.y + box.height <= height - (insets?.bottom ?? 0),
            "Choice stays above the system gesture area",
          );
        }
      } else {
        assert(overflow > 0, "Small viewports retain scrolling");
        await body.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        assert(await body.evaluate((element) => element.scrollTop > 0));
      }
      if (process.env.PVO_EDITOR_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/component-picker-fit-${width}-${theme}.png`,
        });
      await page
        .getByRole("button", { name: "Close components", exact: true })
        .click();
      await settle();
      assert(
        Math.abs((await geometry()).dock.height - original.dock.height) < 2,
        "Closing restores the normal player/timeline split",
      );
      await page
        .getByRole("button", { name: "Components", exact: true })
        .click();
      await picker
        .getByRole("button", { name: "Ask for details", exact: true })
        .click();
      await page.getByRole("dialog", { name: "Form", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `${width} × ${height} ${theme}: ${fits ? "all four choices fit" : "scrolling reaches every choice"}; insertion and restored layout passed.`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
