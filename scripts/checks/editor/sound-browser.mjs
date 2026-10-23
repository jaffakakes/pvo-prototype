import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const url = process.env.EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await launchBrowser({
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  const Base = AudioContext;
  window.soundContexts = [];
  window.AudioContext = class extends Base {
    constructor(...args) {
      super(...args);
      window.soundContexts.push(this);
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
      sound: state.music?.track ?? 0,
      past: state.past.length,
      t: state.t,
      playing: state.playing,
    };
  });
const open = async () => {
  const collapse = page.getByRole("button", { name: /^Collapse .* tools$/ });
  if (await collapse.count()) await collapse.click();
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.getByRole("menuitem", { name: /^(Add sound|Replace)$/ }).click();
  const sheet = page.getByRole("dialog", {
    name: /^(Add sound|Replace sound)$/,
  });
  await sheet.waitFor();
  await settle();
  return sheet;
};
const closedAudio = () =>
  page.waitForFunction(() =>
    window.soundContexts.every((context) => context.state === "closed"),
  );
const artifact = async (name) => {
  if (!process.env.PVO_EDITOR_ARTIFACTS) return;
  await mkdir(process.env.PVO_EDITOR_ARTIFACTS, { recursive: true });
  await page.screenshot({
    path: `${process.env.PVO_EDITOR_ARTIFACTS}/sound-${name}.png`,
  });
};

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
  let sheet = await open();
  assert.equal(
    await sheet.locator("h2").count(),
    0,
    "The sound sheet has no extra title",
  );
  assert.deepEqual(await sheet.getByRole("tab").allTextContents(), [
    "For you",
    "Saved",
    "Recent",
  ]);
  assert.equal(
    await sheet.getByRole("tabpanel", { name: "For you", exact: true }).count(),
    1,
  );
  await sheet.getByRole("tab", { name: "Saved", exact: true }).click();
  await sheet.getByText("No saved sounds yet.", { exact: true }).waitFor();
  await sheet.getByRole("tab", { name: "For you", exact: true }).click();
  const before = await current();
  await sheet
    .getByRole("button", { name: "Preview Night Drive", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.soundContexts.some((context) => context.state === "running"),
  );
  assert.deepEqual(
    await current(),
    before,
    "Auditioning leaves music, playback time and history alone",
  );
  await artifact("preview-390x844");
  await sheet
    .getByRole("button", { name: "Save Night Drive", exact: true })
    .click();
  await sheet.getByRole("tab", { name: "Saved", exact: true }).click();
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Night Drive", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Summer Groove", exact: true })
      .count(),
    0,
  );
  await sheet
    .getByRole("button", { name: "Pause sound preview", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.soundContexts.every((context) => context.state !== "running"),
  );
  await sheet
    .getByRole("button", { name: "Play sound preview", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.soundContexts.some((context) => context.state === "running"),
  );
  await sheet
    .getByRole("button", { name: "Search sounds", exact: true })
    .click();
  const search = sheet.getByRole("textbox", {
    name: "Search sounds",
    exact: true,
  });
  await search.fill("neon");
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Night Drive", exact: true })
      .count(),
    1,
    "Search includes the artist",
  );
  await artifact("search-390x844");
  await search.fill("no match");
  await sheet.getByText("No sounds found.", { exact: true }).waitFor();
  await search.press("Escape");
  assert.equal(
    await sheet.isVisible(),
    true,
    "Escape closes search before the sheet",
  );
  await page.getByRole("button", { name: "Close sheet", exact: true }).click();
  await closedAudio();
  assert.deepEqual(
    await current(),
    before,
    "Closing a preview does not apply the music",
  );

  await page.waitForFunction(async () => {
    const status = (
      await import("/src/app/projectAutosave.ts")
    ).getProjectStorageStatus();
    return (
      status.phase === "ready" &&
      status.storage.phase === "saved" &&
      !status.storage.dirty
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator(".editorWorkspace, .viewfinder")
    .waitFor({ state: "visible" });
  const editSaved = page.getByRole("button", {
    name: "Open editor",
    exact: true,
  });
  if (await editSaved.isVisible()) await editSaved.click();
  sheet = await open();
  await sheet.getByRole("tab", { name: "Saved", exact: true }).click();
  await sheet
    .getByRole("button", { name: "Preview Night Drive", exact: true })
    .click();
  const beforeUse = await current();
  await sheet.getByRole("button", { name: "Use sound", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
  await closedAudio();
  assert.equal((await current()).sound, 2);
  assert.equal(
    (await current()).past,
    beforeUse.past + 1,
    "Use commits one history entry",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await current()).sound, 0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal((await current()).sound, 2);
  sheet = await open();
  await sheet.getByRole("tab", { name: "Recent", exact: true }).click();
  assert.equal(
    await sheet
      .getByRole("button", { name: "Preview Night Drive", exact: true })
      .count(),
    1,
  );
  await sheet.getByRole("tab", { name: "For you", exact: true }).click();
  await sheet
    .getByRole("button", { name: "Preview Summer Groove", exact: true })
    .click();
  await sheet.getByRole("button", { name: "Use sound", exact: true }).click();
  sheet = await open();
  await sheet.getByRole("tab", { name: "Recent", exact: true }).click();
  assert.deepEqual(
    await sheet
      .getByRole("tabpanel")
      .getByRole("button", { name: /^Preview / })
      .allTextContents(),
    ["Summer GrooveLo-Fi Lab · 0:30", "Night DriveNeon Tapes · 0:24"],
  );
  await sheet
    .getByRole("button", { name: "Use Original sound", exact: true })
    .click();
  assert.equal(
    (await current()).sound,
    0,
    "Original sound removes the added music",
  );

  sheet = await open();
  for (const [width, height, theme] of [
    [320, 568, "light"],
    [844, 390, "light"],
    [390, 844, "dark"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await settle();
    await sheet.getByRole("tab", { name: "For you", exact: true }).click();
    await sheet
      .getByRole("button", { name: "Preview Summer Groove", exact: true })
      .click();
    const bar = await sheet
      .getByRole("group", { name: "Sound preview", exact: true })
      .boundingBox();
    const box = await sheet.boundingBox();
    const use = await sheet
      .getByRole("button", { name: "Use sound", exact: true })
      .boundingBox();
    assert(
      bar &&
        box &&
        use &&
        bar.y >= box.y &&
        bar.y + bar.height <= box.y + box.height + 1 &&
        use.y + use.height <= height,
      "The preview and Use stay inside the sheet",
    );
    const list = await sheet.getByRole("tabpanel").boundingBox();
    assert(
      list && list.height >= 44,
      "Sound rows retain a usable scroll area above the preview",
    );
    await artifact(`${width}x${height}-${theme}`);
  }
  await page.getByRole("button", { name: "Close sheet", exact: true }).click();
  await closedAudio();
  assert.deepEqual(errors, []);
  console.log(
    "Sound browser passed: preview/apply separation, real pause/resume and cleanup, saved/recent persistence, search, Original sound, history, pinned controls and responsive light/dark layouts.",
  );
} finally {
  await context.close();
  await browser.close();
}
