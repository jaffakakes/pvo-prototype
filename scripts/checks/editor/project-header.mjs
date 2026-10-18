import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      fileURLToPath(
        new URL("../../../share/assets/preview.mp4", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  const header = page.getByRole("banner", {
    name: "Editor navigation",
    exact: true,
  });
  const title = header.getByRole("textbox", {
    name: "Project title",
    exact: true,
  });
  const saved = header.getByText("Saved in this browser", { exact: true });
  const saving = header.getByText("Saving…", { exact: true });
  await saved.waitFor();
  const snapshot = () =>
    page.evaluate(async () => {
      const { useCapture } = await import("/src/state/captureStore.ts");
      const { localId, clips, past, future, projectName } =
        useCapture.getState();
      return {
        localId,
        clipCount: clips.length,
        past: past.length,
        future: future.length,
        projectName,
      };
    });
  const before = await snapshot();
  await title.click();
  await title.fill("Weekend edit");
  await saving.waitFor();
  assert.equal(
    await saved.count(),
    0,
    "Dirty changes must not claim to be saved during debounce",
  );
  await title.press("Enter");
  assert.equal(
    await title.evaluate((element) => element === document.activeElement),
    false,
    "Enter dismisses title editing",
  );
  await saved.waitFor();
  assert.deepEqual(
    await snapshot(),
    { ...before, projectName: "Weekend edit" },
    "Renaming preserves clips, identity and edit history",
  );
  await page.reload({ waitUntil: "networkidle" });
  await saved.waitFor();
  assert.equal(
    await title.inputValue(),
    "Weekend edit",
    "The title restores from the real autosave checkpoint",
  );

  const restored = await snapshot();

  // Abort a real checkpoint write; recovery must use the existing storage controls.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.failHeaderSave = true;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.failHeaderSave && this.name === "checkpoints")
        throw new DOMException("Header save fixture", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await title.click();
  await title.fill("Keep this unsaved title");
  await title.press("Enter");
  const attention = header.getByText("Save needs attention", { exact: true });
  await attention.waitFor();
  assert.equal(await saved.count(), 0, "A failed save never shows success");
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  assert.equal(
    await attention.isVisible(),
    true,
    "Dismissing the failure banner preserves the header status",
  );
  await page.evaluate(() => {
    window.failHeaderSave = false;
  });
  await page
    .getByRole("button", { name: "Back to camera", exact: true })
    .click();
  await page.getByText("Storage options", { exact: true }).click();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await saved.waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await saved.waitFor();
  assert.equal(
    await title.inputValue(),
    "Keep this unsaved title",
    "Retry saves the current title without replacing it",
  );
  assert.equal((await snapshot()).localId, restored.localId);

  const longTitle = "A long project title ".repeat(6);
  await title.click();
  await title.fill(longTitle);
  await title.press("End");
  await title.press("x");
  assert.equal(
    (await title.inputValue()).length,
    120,
    "The title respects the checkpoint name limit",
  );
  await title.press("Enter");
  await saved.waitFor();
  await page.setViewportSize({ width: 320, height: 568 });
  const bounds = await title.boundingBox();
  const signIn = await header
    .getByRole("button", { name: "Sign in", exact: true })
    .boundingBox();
  assert(
    bounds &&
      signIn &&
      bounds.x + bounds.width <= signIn.x &&
      signIn.x + signIn.width <= 320,
    "Long titles leave Sign in reachable on small phones",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Project header passed: inline rename, real autosave/reload, pending and failed save status, dismissal, retry, identity/history preservation and long titles.",
  );
} finally {
  await context.close();
  await browser.close();
}
