import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const editorUrl =
  process.env.EDITOR_URL ||
  process.env.RESTYLE_EDITOR_URL ||
  "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

try {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [662, 977],
    [844, 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { settle, geometry, assertDocked } = createSheetDockChecks(page);
    const assertSplit = async () => {
      await settle();
      const layout = await geometry();
      assert(
        Math.abs(
          (layout.dock.height * 5) / 3 -
            layout.previewArea.height -
            layout.transport.height,
        ) < 2,
        "Player and lower region use a fixed 62.5/37.5 split",
      );
      assert.equal(
        await page
          .getByRole("separator", { name: /^Resize (timeline|editing panel)$/ })
          .count(),
        0,
      );
      assert(
        layout.documentOverflow <= 2 &&
          layout.app.bottom <= layout.viewportHeight + 2,
      );
      assert(layout.previewArea.bottom <= layout.transport.top + 1);
      assert(layout.transport.bottom <= layout.dock.top + 1);
      const tools = await page.locator(".toolBar").boundingBox();
      assert(
        tools && Math.abs(tools.y + tools.height - layout.dock.bottom) < 2,
        "Bottom controls stay pinned beneath the scrollable tracks",
      );
      return layout;
    };
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      const original = await assertSplit();
      if (height >= 600) {
        const tracks = await page.locator(".tl").boundingBox();
        const tools = await page.locator(".toolBar").boundingBox();
        assert(
          Math.abs(tracks.y + tracks.height - tools.y) < 2,
          "Natural-height tracks stay next to the bottom toolbar",
        );
      }
      const ratio = original.preview.width / original.preview.height;
      const rowHeight = await page
        .locator(".tlClip")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);
      await page.locator(".tlClip").first().click();
      assert(
        Math.abs((await assertSplit()).dock.height - original.dock.height) < 2,
        "Selecting a clip does not move the player or timeline",
      );
      const collapse = page.getByRole("button", {
        name: /^Collapse .* tools$/,
      });
      if (await collapse.count()) await collapse.click();
      await page
        .locator(".toolBar")
        .getByRole("button", { name: "More", exact: true })
        .click();
      const more = page.getByRole("dialog", { name: "More", exact: true });
      const opened = await assertDocked(more, ratio);
      assert(opened.dock.height >= original.dock.height - 2);
      await more.locator("[data-sheet-body]").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert(
        Math.abs(
          (await assertDocked(more, ratio)).dock.height - opened.dock.height,
        ) < 2,
        "Scrolling editing controls cannot resize the player",
      );
      await more
        .getByRole("button", { name: "Close", exact: true })
        .press("Escape");
      await assertSplit();
      await page.setViewportSize({ width, height: height + 80 });
      const taller = await assertSplit();
      assert(
        taller.dock.height <=
          original.dock.height +
            ((taller.app.height - original.app.height) * 3) / 8 +
            2,
      );
      assert.equal(
        await page
          .locator(".tlClip")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
        rowHeight,
        "Extra panel space must not stretch timeline rows",
      );
      await page.setViewportSize({ width, height });
      assert(
        Math.abs((await assertSplit()).dock.height - original.dock.height) < 2,
      );
      assert.deepEqual(errors, []);
      console.log(`Fixed editor split passed at ${width} × ${height}.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
