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
const cases = [
  {
    width: 430,
    height: 932,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  {
    width: 932,
    height: 430,
    insets: { top: 0, bottom: 21, left: 59, right: 59 },
  },
  { width: 430, height: 850, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
];
try {
  for (const { width, height, insets } of cases) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const { settle, geometry, assertDocked } = createSheetDockChecks(page);
    const checkInsets = async () => {
      await settle();
      const layout = await geometry();
      assert(
        Math.abs(
          Math.max(
            0,
            (layout.dock.height * 5) / 3 -
              layout.previewArea.height -
              layout.transport.height,
          ),
        ) < 2,
      );
      for (const bounds of [
        layout.header,
        layout.previewArea,
        layout.transport,
        layout.dock,
      ]) {
        assert(bounds.top >= insets.top - 1 && bounds.left >= insets.left - 1);
        assert(
          bounds.right <= width - insets.right + 1 &&
            bounds.bottom <= height + 1,
        );
      }
      assert.equal(
        await page
          .getByRole("separator", { name: /^Resize (timeline|editing panel)$/ })
          .count(),
        0,
      );
      return layout;
    };
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      const original = await checkInsets();
      assert(
        Math.abs(original.header.top - insets.top) < 2,
        "The browser must apply the real top safe-area inset",
      );
      for (const button of await page.locator(".toolBar .tools button").all()) {
        const bounds = await button.boundingBox();
        assert(
          bounds && bounds.y + bounds.height <= height - insets.bottom + 1,
          "Toolbar controls stay above the bottom system gesture area",
        );
      }
      await page
        .locator(".toolBar")
        .getByRole("button", { name: "Components", exact: true })
        .click();
      const more = page.getByRole("dialog", {
        name: "Add a component",
        exact: true,
      });
      await assertDocked(
        more,
        original.preview.width / original.preview.height,
      );
      await checkInsets();
      const close = await more
        .getByRole("button", { name: "Close", exact: true })
        .boundingBox();
      assert(
        close &&
          close.y >= insets.top &&
          close.x >= insets.left &&
          close.x + close.width <= width - insets.right,
      );
      await more.getByRole("button", { name: "Close", exact: true }).click();
      await checkInsets();
      console.log(`Fixed panel safe areas passed at ${width} × ${height}.`);
    } finally {
      await session.detach();
      await context.close();
    }
  }
} finally {
  await browser.close();
}
