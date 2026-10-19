import { finishTextEntry } from "../helpers/editor-text.mjs";
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const { settle, geometry, assertDocked, assertCompactChrome } =
  createSheetDockChecks(page);

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  const discard = page.getByRole("dialog", {
    name: "Start over?",
    exact: true,
  });
  assert.equal(
    await discard.getAttribute("aria-modal"),
    "true",
    "Camera dialogs remain modal",
  );
  await discard.getByRole("button", { name: "Keep", exact: true }).click();
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await settle();
  const original = await geometry();
  const ratio = original.preview.width / original.preview.height;
  const video = await page.locator(".pvVideo").elementHandle();
  assert(video);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByRole("dialog", { name: "Add text", exact: true });
  await assertDocked(text, ratio);
  const draft = "Keep these words in the fixed panel";
  await text.getByRole("textbox", { name: "Text content" }).fill(draft);
  await text.getByRole("button", { name: "Text fonts", exact: true }).click();
  await text.locator(".textControls").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const scrolled = await assertDocked(text, ratio);
  assert(Math.abs(scrolled.dock.height - original.dock.height) < 2);
  assert.equal(
    await text.getByRole("textbox", { name: "Text content" }).inputValue(),
    draft,
  );
  assert(
    await video.evaluate((el) => el === document.querySelector(".pvVideo")),
    "Text entry preserves the same video",
  );
  assert.equal(
    await page.getByRole("toolbar", { name: "Playback controls" }).isVisible(),
    true,
    "Lowering the keyboard reveals the shared X",
  );
  await finishTextEntry(text);
  await page.locator(".toolBar").waitFor({ state: "visible" });
  assert(Math.abs((await geometry()).dock.height - original.dock.height) < 2);
  const collapse = page.getByRole("button", { name: /^Collapse .* tools$/ });
  if (await collapse.count()) await collapse.click();
  await page
    .locator(".toolBar")
    .getByRole("button", { name: "Components", exact: true })
    .click();
  const more = page.getByRole("dialog", {
    name: "Add a component",
    exact: true,
  });
  await assertDocked(more, ratio);
  await assertCompactChrome(more);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".pvVideo")?.currentTime > 0.05,
  );
  assert(
    await video.evaluate(
      (el) => el === document.querySelector(".pvVideo") && !el.paused,
    ),
    "The same video keeps playing while docked controls are open",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await page
    .getByRole("button", { name: "Close sheet", exact: true })
    .press("Escape");
  await page.locator(".toolBar").waitFor({ state: "visible" });
  assert(Math.abs((await geometry()).dock.height - original.dock.height) < 2);
  assert(
    await video.evaluate((el) => el === document.querySelector(".pvVideo")),
  );
  await video.dispose();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const durations = await page
    .locator(".editorWorkspace")
    .evaluate((el) =>
      getComputedStyle(el).transitionDuration.split(",").map(parseFloat),
    );
  assert(durations.every((duration) => duration <= 0.01));
  assert.deepEqual(errors, []);
  console.log(
    "Sheet dock passed: fixed split, internal scrolling, text draft, playback, Escape and camera modality.",
  );
} finally {
  await context.close();
  await browser.close();
}
