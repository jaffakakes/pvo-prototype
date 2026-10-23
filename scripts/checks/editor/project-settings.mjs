import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const url = process.env.EDITOR_URL || "http://127.0.0.1:4173/editor/";
const browser = await launchBrowser({
  headless: true,
});
try {
  for (const [width, height, theme] of [
    [320, 568, "light"],
    [430, 932, "dark"],
    [844, 390, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page
      .locator('input[type="file"]')
      .setInputFiles(
        fileURLToPath(
          new URL("../../../share/assets/preview.mp4", import.meta.url),
        ),
      );
    await page
      .getByRole("button", { name: "Open editor", exact: true })
      .click();
    const title = page.getByRole("textbox", {
      name: "Project title",
      exact: true,
    });
    await title.fill("Settings check");
    await title.press("Enter");
    await page.getByText("Saved in this browser", { exact: true }).waitFor();
    const trigger = page.getByRole("button", {
      name: "Project settings",
      exact: true,
    });
    const menu = page.getByRole("dialog", {
      name: "Project settings",
      exact: true,
    });
    await trigger.click();
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.y >= 64 &&
        bounds.x + bounds.width <= width &&
        bounds.y + bounds.height <= height,
    );
    assert.equal(
      await menu
        .getByText(/Account|Replies|Scene|component|Export|System|Light|Dark/)
        .count(),
      0,
    );
    const modes = menu.getByRole("group", { name: "Color mode" });
    for (const mode of ["Dark", "Light", "System"]) {
      const button = modes.getByRole("button", { name: mode, exact: true });
      assert.equal((await button.innerText()).trim(), "");
      assert.equal(await button.locator("svg").count(), 1);
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      await page.waitForFunction(
        (expected) => document.documentElement.dataset.theme === expected,
        mode === "System" ? theme : mode.toLowerCase(),
      );
    }
    const advanced = menu.getByRole("switch", {
      name: "Advanced edits",
      exact: true,
    });
    await advanced.click();
    assert.equal(await advanced.getAttribute("aria-checked"), "true");
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("restyle.editor.advancedEditing"),
      ),
      "true",
    );
    const deleteButton = menu.getByRole("button", {
      name: "Delete Project",
      exact: true,
    });
    assert.equal(
      await menu.locator("button").last().innerText(),
      "Delete Project",
    );
    await deleteButton.click();
    const keep = menu.getByRole("button", {
      name: "Keep project",
      exact: true,
    });
    await keep.waitFor();
    assert(
      await keep.evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press("Escape");
    assert(
      await deleteButton.evaluate(
        (element) => element === document.activeElement,
      ),
    );
    assert.equal(await title.inputValue(), "Settings check");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert(
      await trigger.evaluate((element) => element === document.activeElement),
    );
    await trigger.click();
    await title.click();
    await menu.waitFor({ state: "hidden" });
    assert.equal(await title.inputValue(), "Settings check");
    await page.reload({ waitUntil: "networkidle" });
    await trigger.click();
    assert.equal(await advanced.getAttribute("aria-checked"), "true");
    await advanced.click();
    assert.equal(await advanced.getAttribute("aria-checked"), "false");
    await deleteButton.click();
    await keep.click();
    assert.equal(await title.inputValue(), "Settings check");
    await deleteButton.click();
    await menu
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await menu.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.querySelector(".app")?.getAttribute("data-screen") !==
        "editor",
    );
    await page.waitForFunction(
      () => !localStorage.getItem("restyle-editor-project-discarded"),
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await title.count(),
      0,
      "Deleted project must not return on reload",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}×${height} ${theme}: settings icons, preference persistence, dismissal, delete cancellation and confirmed deletion passed`,
    );
  }
} finally {
  await browser.close();
}
