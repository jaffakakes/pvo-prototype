import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";
import {
  openEditorSettings,
  closeEditorSettings,
} from "../helpers/editor-settings.mjs";

const browser = await launchBrowser({
  headless: true,
});
const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const video = fileURLToPath(
  new URL("../../../share/assets/preview.mp4", import.meta.url),
);
try {
  for (const [width, height, theme] of [
    [390, 844, "light"],
    [390, 844, "dark"],
    [320, 568, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { settle } = createSheetDockChecks(page);
    const controls = page.getByRole("toolbar", {
      name: "Playback controls",
      exact: true,
    });
    const close = controls.getByRole("button", {
      name: "Close sheet",
      exact: true,
    });
    const mainTools = async () => {
      await settle();
      const collapse = page.getByRole("button", {
        name: /^Collapse .* tools$/,
      });
      if (await collapse.count()) await collapse.click();
    };
    const closeSheet = async (panel, tool = false) => {
      await panel.waitFor();
      await settle();
      assert.equal(
        await controls
          .getByRole("button", { name: "Try", exact: true })
          .count(),
        0,
      );
      const dismiss = tool
        ? controls.getByRole("button", { name: "Close tool", exact: true })
        : close;
      assert.equal(await dismiss.count(), 1);
      assert.equal(
        await panel
          .getByRole("button", { name: /^(Close|Done|Back|Close Animate)$/ })
          .count(),
        0,
      );
      const box = await dismiss.boundingBox();
      assert(box.width >= 44 && box.height >= 44);
      const preview = await page.locator(".pvBox").boundingBox();
      for (const button of await controls.getByRole("button").all()) {
        const action = await button.boundingBox();
        const horizontal =
          Math.min(action.x + action.width, preview.x + preview.width) -
          Math.max(action.x, preview.x);
        const vertical =
          Math.min(action.y + action.height, preview.y + preview.height) -
          Math.max(action.y, preview.y);
        assert(
          horizontal <= 0 || vertical <= 0,
          "Sheet controls stay separate from the video",
        );
      }
      assert.equal(
        await dismiss.evaluate((el) => getComputedStyle(el).boxShadow),
        "none",
      );
      if (
        process.env.PVO_EDITOR_ARTIFACTS &&
        (await panel.getAttribute("aria-label")) === "Add a component" &&
        (await page.locator(".compBar, .compMarker").count()) === 0
      )
        await page.screenshot({
          path: `${process.env.PVO_EDITOR_ARTIFACTS}/sheet-close-${width}-${theme}.png`,
        });
      await dismiss.click();
      await panel.waitFor({ state: "hidden" });
      await settle();
      await controls
        .getByRole("button", { name: "Try", exact: true })
        .waitFor();
    };
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').setInputFiles(video);
      await page
        .getByRole("button", { name: "Open editor", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Components", exact: true })
        .click();
      await closeSheet(
        page.getByRole("dialog", { name: "Add a component", exact: true }),
      );
      for (const [choice, name] of [
        ["Add a note", "Note"],
        ["Show a message", "Message"],
        ["Let viewers choose", "Choice"],
        ["Ask for details", "Form"],
      ]) {
        await mainTools();
        await page
          .getByRole("button", { name: "Components", exact: true })
          .click();
        await page.getByRole("button", { name: choice, exact: true }).click();
        await closeSheet(page.getByRole("dialog", { name, exact: true }));
      }
      await mainTools();
      await page.locator(".tlClip").first().click();
      for (const name of ["Speed", "Crop", "Volume"]) {
        await page
          .getByRole("button", {
            name,
            exact: true,
          })
          .click();
        await closeSheet(page.getByRole("region", { name, exact: true }), true);
      }
      await mainTools();
      for (const [item, name, role] of [
        ["Add sound", "Add sound", "dialog"],
        ["Sound effect", "Sound effects", "dialog"],
        ["Voiceover", "Voiceover", "group"],
      ]) {
        await page.getByRole("button", { name: "Sound", exact: true }).click();
        await page.getByRole("menuitem", { name: item, exact: true }).click();
        await closeSheet(page.getByRole(role, { name, exact: true }));
      }
      await page
        .getByRole("button", { name: "Aspect ratio", exact: true })
        .click();
      await closeSheet(
        page.getByRole("dialog", { name: "Aspect ratio", exact: true }),
      );
      await page.getByRole("button", { name: "Text", exact: true }).click();
      const text = page.getByRole("dialog", { name: "Add text", exact: true });
      await text
        .getByRole("textbox", { name: "Text content", exact: true })
        .fill("Keep this text");
      assert.equal(
        await controls.isVisible(),
        false,
        "Typing keeps the keyboard layout",
      );
      await text
        .getByRole("button", { name: "Hide keyboard", exact: true })
        .click();
      await closeSheet(text);
      assert.equal(
        await page.locator(".textBar").count(),
        1,
        "Closing commits the text draft once",
      );
      await controls.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await page.locator(".textBar").count(), 0);
      await controls.getByRole("button", { name: "Redo", exact: true }).click();
      await page.locator(".textBar").click();
      await page.getByRole("button", { name: "Timing", exact: true }).click();
      await closeSheet(
        page.getByRole("dialog", { name: "Text timing", exact: true }),
      );
      await mainTools();
      await openEditorSettings(page);
      await closeEditorSettings(page);
      assert.deepEqual(errors, []);
      console.log(
        `${width} × ${height} ${theme}: shared X across editing sheets, text commit/Undo/Redo and keyboard layout passed.`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
