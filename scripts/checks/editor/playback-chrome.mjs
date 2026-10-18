import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
try {
  for (const [width, height] of [[320, 568], [390, 844], [662, 977], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const { settle, geometry } = createSheetDockChecks(page);
    try {
      await page.goto(editorUrl, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').setInputFiles(videoFile);
      await page.getByRole("button", { name: "Open editor", exact: true }).click();
      await settle();
      assert.equal(await page.locator(".editorHead button").count(), 1);
      assert.equal(await page.locator(".editorHead h1, .editorHead p").count(), 0);
      assert.equal(await page.locator(".editorHead").getByRole("button", { name: "More", exact: true }).count(), 0);
      const controls = page.getByRole("toolbar", { name: "Playback controls", exact: true });
      const play = controls.getByRole("button", { name: "Play", exact: true });
      const undo = controls.getByRole("button", { name: "Undo", exact: true });
      const redo = controls.getByRole("button", { name: "Redo", exact: true });
      const trying = controls.getByRole("button", { name: "Try", exact: true });
      const bounds = await Promise.all([play, undo, redo, trying].map(button => button.boundingBox()));
      assert(bounds.every(b => b && b.width >= 44 && b.height >= 44 && b.x >= 0 && b.x + b.width <= width));
      for (let i = 1; i < bounds.length; i++) assert(bounds[i].x >= bounds[i - 1].x + bounds[i - 1].width);
      const look = await play.evaluate(el => {
        const style = getComputedStyle(el);
        return { border: style.borderWidth, radius: style.borderRadius, background: style.backgroundColor, shadow: style.boxShadow };
      });
      assert.deepEqual(look, { border: "0px", radius: "0px", background: "rgba(0, 0, 0, 0)", shadow: "none" });
      const layout = await geometry();
      assert.equal(layout.header.height, 0);
      assert.equal(layout.preview.top, layout.previewArea.top, "The video reaches the top of the player region");
      assert.equal(layout.previewArea.top, 0, "Overlay navigation leaves no top toolbar gap");
      assert(layout.dock.height <= height / 4 + 2);
      await play.click();
      await controls.getByRole("button", { name: "Pause", exact: true }).waitFor();
      await controls.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Text", exact: true }).click();
      const text = page.getByRole("dialog", { name: "Add text", exact: true });
      await text.getByRole("textbox", { name: "Text content", exact: true }).fill("History stays beside Play");
      await text.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator(".textBar").waitFor();
      await undo.click();
      assert.equal(await page.locator(".textBar").count(), 0);
      await redo.click();
      await page.locator(".textBar").waitFor();
      await trying.click();
      const stop = page.getByRole("button", { name: "Stop trying", exact: true });
      await stop.waitFor();
      await stop.click();
      await trying.waitFor();
      await settle();
      assert((await geometry()).dock.height <= height / 4 + 2);
      await page.getByRole("button", { name: "Back to camera", exact: true }).click();
      await page.locator(".viewfinder").waitFor();
      assert.deepEqual(errors, []);
      console.log(`Playback chrome passed at ${width} × ${height}.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
