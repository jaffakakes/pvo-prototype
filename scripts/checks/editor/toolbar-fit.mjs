import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
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
      ["Edit clip", "Text", "Components", "Sound", "More"],
      `The main toolbar should retain five items at ${width}px`);
    for (const name of ["Components", "More"]) {
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
    await toolbar.getByRole("button", { name: "More", exact: true }).click();
    const moreDialog = page.getByRole("dialog", { name: "More" });
    await moreDialog.getByText("Ratio", { exact: true }).first().waitFor();
    const advanced = moreDialog.getByRole("switch", { name: "Advanced editing", exact: true });
    assert.equal(await advanced.isVisible(), true, `Advanced editing is not available from More at ${width}px`);
    await advanced.click();
    assert.equal(await moreDialog.getByRole("textbox", { name: "Allowed request domains" }).isVisible(), true,
      `Project-wide allowed request domains are not available from More at ${width}px`);
    const moreShot = process.env[`MORE_SHEET_SHOT_${width}`] ||
      (process.env.CAPTURE_SHOTS && [320, 430].includes(width) ? resolve(tmpdir(), `restyle-more-${width}.png`) : null);
    if (moreShot) await moreDialog.screenshot({ path: moreShot });
    await moreDialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Components", exact: true }).click();
    await page.getByRole("dialog", { name: "Add a component" }).waitFor();
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    console.log(`${width}px: five toolbar labels fit their tiles; More exposes Ratio and Advanced; Components opens its sheet`);
    await page.close();
  }
} finally {
  await browser.close();
}
