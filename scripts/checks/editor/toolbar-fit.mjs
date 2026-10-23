import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { resolve } from "node:path";


const browser = await launchBrowser({
  headless: true,
  args: ["--no-sandbox"],
});

try {
  for (const width of [320, 370, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByRole("button", { name: "Stop recording" }).waitFor();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await page.getByRole("button", { name: "Open editor" }).click();
    await page.getByRole("button", { name: "Components", exact: true }).waitFor();
    const toolbar = page.locator(".tools");
    assert.deepEqual((await toolbar.getByRole("button").allTextContents()).map(label => label.trim()),
      ["Edit clip", "Text", "Components", "Sound", "Aspect ratio"],
      `The main toolbar should retain five items at ${width}px`);
    for (const name of ["Components", "Aspect ratio"]) {
      const geometry = await toolbar.getByRole("button", { name, exact: true }).evaluate(button => {
        const label = button.querySelector("span");
        const tile = button.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return { tileLeft: tile.left, tileRight: tile.right, textLeft: text.left, textRight: text.right, textWidth: text.width };
      });
      assert.ok(geometry.textLeft >= geometry.tileLeft + 2 && geometry.textRight <= geometry.tileRight - 2,
        `${name} label escapes its tile at ${width}px: ${JSON.stringify(geometry)}`);
    }
    if (process.env.CAPTURE_SHOTS && width === 370) await page.screenshot({ path: resolve(tmpdir(), "restyle-tool-row-fit.png") });
    await toolbar.getByRole("button", { name: "Aspect ratio", exact: true }).click();
    const ratio = page.getByRole("dialog", { name: "Aspect ratio", exact: true });
    for (const name of ["9:16", "1:1", "4:5", "16:9"]) {
      await ratio.getByRole("button", { name, exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "Close sheet", exact: true }).click();
    await page.getByRole("button", { name: "Components", exact: true }).click();
    await page.getByRole("dialog", { name: "Add a component" }).waitFor();
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    console.log(`${width}px: five toolbar labels fit their tiles; Aspect ratio opens its compact choices; Components opens its sheet`);
    await page.close();
  }
} finally {
  await browser.close();
}
