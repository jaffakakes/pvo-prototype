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
});
try {
  for (const [width, height, theme, insets] of [
    [320, 568, "light"],
    [390, 844, "light"],
    [390, 844, "dark"],
    [844, 390, "light"],
    [430, 932, "light", { top: 59, bottom: 34, left: 0, right: 0 }],
    [932, 430, "dark", { top: 0, bottom: 21, left: 59, right: 59 }],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { settle, geometry } = createSheetDockChecks(page);
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
      const orb = page.locator("[data-assistant-orb]");
      const originalOrb = await orb.boundingBox();
      const assertOrbRestored = async () => {
        const current = await orb.boundingBox();
        assert(
          originalOrb &&
            current &&
            Math.abs(current.x - originalOrb.x) < 2 &&
            Math.abs(current.y - originalOrb.y) < 2,
          `Orb returns to its position after Ratio closes: ${JSON.stringify({ originalOrb, current })}`,
        );
      };
      const trigger = page.getByRole("button", {
        name: "Aspect ratio",
        exact: true,
      });
      const panel = page.getByRole("dialog", {
        name: "Aspect ratio",
        exact: true,
      });
      assert.equal(
        await page
          .locator(".toolBar")
          .getByRole("button", { name: "More", exact: true })
          .count(),
        0,
      );
      const open = async () => {
        await trigger.click();
        await panel.waitFor();
        await settle();
      };
      await open();
      const layout = await geometry(),
        box = await panel.boundingBox();
      const track = await page.locator(".tlClip").first().boundingBox();
      assert.equal(
        await page.locator(".editorWorkspace").getAttribute("data-sheet-open"),
        "false",
      );
      assert.equal(await page.locator(".tlClip:visible").count(), 1);
      assert(
        box &&
          Math.abs(box.x - (insets?.left ?? 0)) < 2 &&
          Math.abs(
            box.width - (width - (insets?.left ?? 0) - (insets?.right ?? 0)),
          ) < 2 &&
          box.height <= 180 &&
          Math.abs(box.y + box.height - height) < 2,
        `Panel touches bottom and both sides: ${JSON.stringify(box)}`,
      );
      assert(
        track && track.y + track.height <= box.y + 2,
        `Timeline is above panel: ${JSON.stringify({ track, box })}`,
      );
      assert.equal(
        await panel.evaluate((element) => getComputedStyle(element).position),
        "relative",
      );
      assert.equal(
        await panel.evaluate((element) => getComputedStyle(element).boxShadow),
        "none",
      );
      assert(layout.preview.height > 0 && layout.visibility.playback);
      const choices = panel.getByRole("group", {
        name: "Video ratio",
        exact: true,
      });
      for (const ratio of ["1:1", "4:5", "16:9", "9:16"]) {
        const button = choices.getByRole("button", {
          name: ratio,
          exact: true,
        });
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        const hit = await button.boundingBox();
        assert(hit.width >= 44 && hit.height >= 44);
        await settle();
        const { preview, previewArea, transport, controlsRow } =
          await geometry();
        const [w, h] = ratio.split(":").map(Number);
        if (ratio === "16:9" || ratio === "1:1") {
          assert(
            Math.abs(
              (preview.top + preview.bottom) / 2 -
                (previewArea.top +
                  (controlsRow ? transport.top : previewArea.bottom)) /
                  2,
            ) < 1,
            `${ratio} video stays vertically centred in the player`,
          );
          if (process.env.PVO_EDITOR_ARTIFACTS)
            await page.screenshot({
              path: `${process.env.PVO_EDITOR_ARTIFACTS}/aspect-ratio-centered-${ratio.replace(":", "x")}-${width}-${theme}.png`,
            });
        }
        assert(Math.abs(preview.width / preview.height - w / h) < 0.02);
        for (const action of await page.locator(".transport button").all()) {
          const bounds = await action.boundingBox();
          const horizontal =
            Math.min(bounds.x + bounds.width, preview.right) -
            Math.max(bounds.x, preview.left);
          const vertical =
            Math.min(bounds.y + bounds.height, preview.bottom) -
            Math.max(bounds.y, preview.top);
          assert(
            horizontal <= 0 || vertical <= 0,
            `${ratio} keeps editing controls separate from video`,
          );
        }
        const stamp = await page.locator(".transportTime").boundingBox();
        const close = await page
          .getByRole("button", { name: "Close sheet", exact: true })
          .boundingBox();
        assert(
          stamp.x >= preview.left - 1 &&
            stamp.x + stamp.width <= preview.right + 1,
          "Timestamp stays inside every ratio",
        );
        assert(
          stamp.x + stamp.width <= close.x ||
            stamp.y + stamp.height <= close.y ||
            stamp.x >= close.x + close.width,
          "Timestamp and Preview/Close never overlap",
        );
      }
      await choices.getByRole("button", { name: "1:1", exact: true }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(
        await choices
          .getByRole("button", { name: "9:16", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal(
        await choices
          .getByRole("button", { name: "1:1", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      if (process.env.PVO_EDITOR_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/aspect-ratio-bottom-${width}-${theme}.png`,
        });
      await page
        .getByRole("button", { name: "Close sheet", exact: true })
        .click();
      await settle();
      assert(
        Math.abs((await geometry()).dock.height - original.dock.height) < 2,
        "Close restores normal toolbar and player space",
      );
      await assertOrbRestored();
      await open();
      await page
        .getByRole("button", { name: "Close sheet", exact: true })
        .click();
      await settle();
      await assertOrbRestored();
      await page
        .locator(".editorHead")
        .getByText("Saved in this browser", { exact: true })
        .waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await open();
      assert.equal(
        await panel
          .getByRole("button", { name: "1:1", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page
        .getByRole("button", { name: "Close sheet", exact: true })
        .press("Escape");
      await panel.waitFor({ state: "hidden" });
      await settle();
      await assertOrbRestored();
      if (process.env.PVO_EDITOR_ARTIFACTS)
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/aspect-ratio-closed-${width}-${theme}.png`,
        });
      assert.deepEqual(errors, []);
      console.log(
        `${width} × ${height} ${theme}: bottom ratio panel, exposed timeline, ratio preview, Undo/Redo, autosave, X/Escape and stable orb position passed.`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
