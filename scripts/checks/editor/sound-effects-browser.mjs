import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const url = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  const Base = Audio;
  window.effectElements = [];
  window.Audio = class extends Base {
    constructor(...args) {
      super(...args);
      window.effectElements.push(this);
    }
  };
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const { settle } = createSheetDockChecks(page);
const current = () =>
  page.evaluate(async () => {
    const state = (
      await import("/src/state/captureStore.ts")
    ).useCapture.getState();
    return {
      sound: state.sound,
      audio: state.audioClips,
      past: state.past.length,
      t: state.t,
      playing: state.playing,
    };
  });
const open = async () => {
  const collapse = page.getByRole("button", { name: /^Collapse .* tools$/ });
  if (await collapse.count()) await collapse.click();
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Sound effect", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Sound effects",
    exact: true,
  });
  await sheet.waitFor();
  await settle();
  return sheet;
};
const closedAudio = () =>
  page.waitForFunction(async () => {
    const state = (
      await import("/src/state/captureStore.ts")
    ).useCapture.getState();
    const projectUrls = state.audioClips.map((clip) => clip.url);
    return window.effectElements.every(
      (audio) =>
        projectUrls.includes(audio.getAttribute("src")) ||
        (audio.paused && !audio.getAttribute("src")),
    );
  });
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      fileURLToPath(
        new URL("../../../share/assets/preview.mp4", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.evaluate(async () => {
    (await import("/src/state/captureStore.ts")).useCapture
      .getState()
      .patch({ sound: 2, t: 2.5, past: [], future: [] });
    (await import("/src/state/preferences/soundLibrary.ts")).toggleSavedSound(
      "Night Drive",
    );
  });
  let sheet = await open();
  assert.deepEqual(await sheet.getByRole("tab").allTextContents(), [
    "For you",
    "Saved",
    "Recent",
  ]);
  assert.equal(await sheet.locator("h2").count(), 0);
  assert.equal(
    await sheet
      .getByRole("button", { name: "Use Original sound", exact: true })
      .count(),
    0,
  );
  const before = await current();
  await sheet
    .getByRole("button", { name: "Preview Chime", exact: true })
    .click();
  await sheet
    .getByRole("button", { name: "Pause sound preview", exact: true })
    .click();
  const paused = await page.evaluate(
    () => window.effectElements.at(-1).currentTime,
  );
  await page.waitForTimeout(100);
  assert(
    Math.abs(
      (await page.evaluate(() => window.effectElements.at(-1).currentTime)) -
        paused,
    ) < 0.03,
    "Pause retains the actual effect position",
  );
  await sheet
    .getByRole("button", { name: "Play sound preview", exact: true })
    .click();
  await page.waitForFunction(() => !window.effectElements.at(-1).paused);
  assert.deepEqual(
    await current(),
    before,
    "Previewing does not edit music, audio, time or history",
  );
  await sheet.getByRole("button", { name: "Preview Pop", exact: true }).click();
  await page.waitForFunction(() => window.effectElements.at(-1).ended);
  await sheet
    .getByRole("button", { name: "Play sound preview", exact: true })
    .waitFor();
  await sheet.getByRole("button", { name: "Save Pop", exact: true }).click();
  await sheet.getByRole("tab", { name: "Saved", exact: true }).click();
  assert.deepEqual(
    await sheet
      .getByRole("tabpanel")
      .getByRole("button", { name: /^Preview / })
      .allTextContents(),
    ["PopSound effect · 0.24s"],
    "Saved effects exclude music bookmarks",
  );
  await sheet
    .getByRole("button", { name: "Search sounds", exact: true })
    .click();
  const search = sheet.getByRole("textbox", {
    name: "Search sounds",
    exact: true,
  });
  await search.fill("whoosh");
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Whoosh", exact: true })
      .count(),
    1,
  );
  await search.fill("no match");
  await sheet.getByText("No sounds found.", { exact: true }).waitFor();
  await search.press("Escape");
  assert.equal(await sheet.isVisible(), true);
  await page.getByRole("button", { name: "Close sheet", exact: true }).click();
  await closedAudio();
  assert.deepEqual(
    await current(),
    before,
    "Dismissing an effect leaves the project unchanged",
  );
  sheet = await open();
  await sheet.getByRole("tab", { name: "Saved", exact: true }).click();
  await sheet.getByRole("button", { name: "Preview Pop", exact: true }).click();
  await sheet.getByRole("button", { name: "Use sound", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
  await closedAudio();
  const applied = await current();
  assert.equal(applied.audio.length, 1);
  assert.equal(applied.audio[0].name, "Pop");
  assert.equal(applied.audio[0].start, 2.5);
  assert.equal(applied.audio[0].out, 0.24);
  assert.equal(applied.past, before.past + 1);
  assert.equal(applied.sound, 2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await current()).audio.length, 0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal((await current()).audio.length, 1);
  sheet = await open();
  await sheet.getByRole("tab", { name: "Recent", exact: true }).click();
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Pop", exact: true })
      .count(),
    1,
  );
  for (const [width, height, theme] of [
    [390, 844, "light"],
    [320, 568, "light"],
    [844, 390, "light"],
    [390, 844, "dark"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await settle();
    await sheet.getByRole("tab", { name: "For you", exact: true }).click();
    await sheet
      .getByRole("button", { name: "Preview Pop", exact: true })
      .click();
    const bar = await sheet
      .getByRole("group", { name: "Sound preview", exact: true })
      .boundingBox();
    const list = await sheet.getByRole("tabpanel").boundingBox();
    assert(
      bar && bar.y + bar.height <= height && list && list.height >= 44,
      "The effect list and pinned preview fit short and narrow screens",
    );
    if (process.env.PVO_EDITOR_ARTIFACTS) {
      await mkdir(process.env.PVO_EDITOR_ARTIFACTS, { recursive: true });
      await page.screenshot({
        path: `${process.env.PVO_EDITOR_ARTIFACTS}/effects-${width}x${height}-${theme}.png`,
      });
    }
  }
  await page.getByRole("button", { name: "Close sheet", exact: true }).click();
  await closedAudio();
  assert.deepEqual(errors, []);
  console.log(
    "Sound effects browser passed: shared tabs/search, bookmarks, independent preview/pause/end/replay, cleanup, one-step insertion at the playhead, music preservation, Undo/Redo, Recent and responsive layouts.",
  );
} finally {
  await context.close();
  await browser.close();
}
