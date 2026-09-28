import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

// Prerequisites: a running editor and installed Chrome (or CHROME_PATH).
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 850 }, hasTouch: true, permissions: [] });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const { separator, settle, geometry, assertDocked, dragBy, assertCompactChrome, assertFullscreen, assertFullscreenRoundTrip } =
  createSheetDockChecks(page, context);

async function assertTimelineRestored() {
  await page.locator(".tl").waitFor({ state: "visible" });
  await page.locator(".toolBar").waitFor({ state: "visible" });
  await settle();
  assert.equal(await page.getByRole("dialog").count(), 0, "Dismissing should remove the editing panel");
  assert.equal(await separator.count(), 0, "The sheet resize handle should disappear with the panel");
}

async function collapseSelection() {
  await page.locator(".toolBar").waitFor({ state: "visible" });
  await settle();
  const collapse = page.getByRole("button", { name: /^Collapse (?:text|component|clip) tools$/ });
  if (await collapse.count()) await collapse.click();
}

async function assertContentScrollDoesNotResize(dialog) {
  const scroller = dialog.locator(".textControls");
  await scroller.waitFor();
  assert(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 10), "Style controls should overflow in this fixture");
  const before = await geometry();
  await scroller.hover();
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => document.querySelector(".textControls")?.scrollTop > 0);
  const after = await geometry();
  assert(Math.abs(before.dock.height - after.dock.height) < 1, "Scrolling sheet contents must not move the splitter");
  assert(Math.abs(before.previewArea.height - after.previewArea.height) < 1, "Content scrolling must not resize the player");
}

async function assertPlayheadRoundTrip(dialog, ratio) {
  const before = await geometry();
  const original = (await dialog.locator(".componentTiming strong").textContent())?.trim();
  await dialog.getByRole("button", { name: "Use playhead", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const controls = page.locator('.toolBar[data-time-pick="true"]');
  await controls.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  assert(await page.locator(".tl").isVisible(), "Playhead selection must temporarily restore the timeline");
  const timeline = await page.locator(".tl").boundingBox();
  assert(timeline);
  await page.mouse.move(timeline.x + Math.min(270, timeline.width - 20), timeline.y + 12);
  await page.mouse.down();
  await page.mouse.move(timeline.x + 180, timeline.y + 12, { steps: 8 });
  await page.mouse.up();
  await controls.getByRole("button", { name: "Cancel", exact: true }).click();
  const restored = before.fullscreen ? await assertFullscreen(dialog) : await assertDocked(dialog, ratio);
  assert.equal((await dialog.locator(".componentTiming strong").textContent())?.trim(), original, "Cancelling the picker must preserve timing");
  assert(Math.abs(restored.dock.height - before.dock.height) < 2, "Returning from the picker must restore the chosen panel height");
}

async function createBranchScene(choice) {
  await choice.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  const outcome = page.getByRole("dialog", { name: /where\?/ });
  await outcome.getByRole("button", { name: /Go to scene/ }).click();
  await outcome.getByRole("button", { name: /New scene/ }).click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.locator(".scenesRow").waitFor({ state: "visible" });
  assert.equal(await page.locator(".sceneChip").count(), 2, "The scene-row fixture needs two real scenes");
  await page.locator(".sceneChip").first().click();
  await page.getByRole("button", { name: "Select component layer: choice", exact: true }).click();
  await page.locator(".tools").getByRole("button", { name: "Edit", exact: true }).click();
  await choice.waitFor();
}

async function assertAiMenuIsAccessible() {
  await page.getByRole("button", { name: "Restyle AI", exact: true }).click();
  const actions = page.locator(".orbActs");
  await actions.waitFor();
  await actions.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  for (const action of await actions.getByRole("button").all()) {
    await action.click({ trial: true });
    const unclipped = await action.evaluate(element => {
      const box = element.getBoundingClientRect();
      return [box.top + 10, box.bottom - 10].every(y =>
        element.contains(document.elementFromPoint(box.left + box.width / 2, y)));
    });
    assert(unclipped, "The AI menu must remain clickable above the timeline boundary");
  }
  await page.getByRole("button", { name: "Restyle AI", exact: true }).click();
  await actions.waitFor({ state: "hidden" });
}

async function assertNestedRequestEscape(choice) {
  await choice.locator(".componentOptionRow").nth(1).locator(".componentOutcome").click();
  const outcome = page.getByRole("dialog", { name: /where\?/ });
  await outcome.getByRole("button", { name: /Send request/ }).click();
  await outcome.getByRole("textbox", { name: "Request URL" }).fill("https://example.com/submit");
  await outcome.getByRole("button", { name: "POST", exact: true }).click();
  await outcome.getByRole("textbox", { name: "Request JSON body" }).fill('{"message":"preserve"}');
  await outcome.getByRole("button", { name: /On success/ }).click();
  const success = page.getByRole("dialog", { name: "When it succeeds", exact: true });
  await success.getByRole("button", { name: "Back", exact: true }).press("Escape");
  await outcome.waitFor({ state: "visible" });
  assert.equal(await outcome.getByRole("textbox", { name: "Request URL" }).inputValue(), "https://example.com/submit");
  assert.equal(await outcome.getByRole("textbox", { name: "Request JSON body" }).inputValue(), '{"message":"preserve"}');
  await outcome.getByRole("textbox", { name: "Request URL" }).press("Escape");
  await choice.waitFor({ state: "visible" });
  assert.equal(await choice.locator(".componentOptionRow").nth(1).locator(".componentOutcome").innerText(), "Request");
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.getByRole("button", { name: "Add sound", exact: true }).click();
  const cameraSheet = page.getByRole("dialog", { name: "Sound", exact: true });
  assert.equal(await cameraSheet.getAttribute("aria-modal"), "true", "Camera sheets must remain modal");
  assert.equal(await page.locator(".sheetScrim:visible").count(), 1);
  await cameraSheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".editorWorkspace").waitFor();
  await settle();
  let layout = await geometry();
  let ratio = layout.preview.width / layout.preview.height;
  await assertAiMenuIsAccessible();

  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("dialog", { name: "More", exact: true });
  await assertDocked(more, ratio);
  await assertCompactChrome(more);
  await assertFullscreenRoundTrip(more, ratio, false, true);
  await more.getByRole("switch", { name: "Advanced editing", exact: true }).click();
  await more.getByRole("button", { name: "1:1", exact: true }).click();
  await assertDocked(more, 1);
  await more.getByRole("button", { name: "9:16", exact: true }).click();
  ratio = 9 / 16;
  await assertDocked(more, ratio);
  await separator.focus();
  await separator.press("Escape");
  await assertTimelineRestored();

  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByRole("dialog", { name: "Add text", exact: true });
  const draft = "Keep these words while resizing";
  await text.getByRole("textbox", { name: "Text content" }).fill(draft);
  const initial = await assertDocked(text, ratio);
  const video = await page.locator(".pvVideo").elementHandle();
  assert(video, "The media fixture must have a live video element");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    return video && video.currentTime > 0.05 && !video.paused;
  });
  const timeBeforeResize = await video.evaluate(element => element.currentTime);
  await dragBy(-75, true);
  const grown = await assertDocked(text, ratio);
  const playback = await video.evaluate(element => ({
    sameNode: element === document.querySelector(".pvVideo"), paused: element.paused, time: element.currentTime,
  }));
  assert(playback.sameNode && !playback.paused && playback.time > timeBeforeResize,
    "Resizing must preserve the video element and advancing playback");
  await assertFullscreenRoundTrip(text, ratio, true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await video.dispose();
  assert(grown.dock.height > initial.dock.height + 40 && grown.previewArea.height < initial.previewArea.height - 40,
    "Dragging up must grow the panel and shrink the player region");
  await dragBy(55);
  const lowered = await assertDocked(text, ratio);
  assert(lowered.dock.height < grown.dock.height - 30 && lowered.previewArea.height > grown.previewArea.height + 30,
    "Dragging down must shrink the panel and grow the player region");
  assert.equal(await text.getByRole("textbox", { name: "Text content" }).inputValue(), draft);
  await dragBy(-45, true, true);
  const cancelled = await assertDocked(text, ratio);
  assert(Math.abs(cancelled.dock.height - lowered.dock.height) < 2, "A cancelled pointer gesture must restore its starting height");
  assert.equal(await page.locator(".editorWorkspace").getAttribute("data-resizing"), "false", "Pointer cancellation must release drag state");
  await separator.focus();
  await separator.press("ArrowUp");
  const keyUp = await assertDocked(text, ratio);
  assert(keyUp.dock.height > lowered.dock.height, "ArrowUp must expand the editing panel");
  await separator.press("ArrowDown");
  const keyDown = await assertDocked(text, ratio);
  assert(keyDown.dock.height < keyUp.dock.height, "ArrowDown must shrink the editing panel");
  await text.getByRole("tab", { name: "Style", exact: true }).click();
  await assertContentScrollDoesNotResize(text);
  await separator.focus();
  await separator.press("Home");
  const expanded = await assertFullscreen(text);
  assert(expanded.dock.height > keyDown.dock.height, "Home must expand the editing panel");
  assert.equal(await text.getByRole("textbox", { name: "Text content" }).inputValue(), draft);
  await dragBy(expanded.dock.height - keyDown.dock.height);
  await assertDocked(text, ratio);
  // The last project edit was 1:1 -> 9:16. Resize gestures must not insert an undo step ahead of it.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await assertDocked(text, 1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await assertDocked(text, ratio);
  assert.equal(await text.getByRole("textbox", { name: "Text content" }).inputValue(), draft,
    "Presentation gestures and ratio undo/redo must preserve the text draft");
  await text.getByRole("button", { name: "Add", exact: true }).click();
  await assertTimelineRestored();
  await collapseSelection();

  await page.getByRole("button", { name: "Components", exact: true }).click();
  await assertDocked(page.getByRole("dialog", { name: "Components", exact: true }), ratio);
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  const choice = page.getByRole("dialog", { name: "Choice", exact: true });
  await assertDocked(choice, ratio);
  await createBranchScene(choice);
  await assertDocked(choice, ratio);
  await assertNestedRequestEscape(choice);
  await dragBy(-35);
  await assertPlayheadRoundTrip(choice, ratio);
  const fieldsPartial = await geometry();
  await separator.press("Home");
  const fieldsFull = await assertFullscreen(choice);
  await assertPlayheadRoundTrip(choice, ratio);
  await dragBy(fieldsFull.dock.height - fieldsPartial.dock.height);
  await assertDocked(choice, ratio);
  await choice.getByRole("tab", { name: "Advanced", exact: true }).click();
  const source = choice.getByRole("textbox", { name: "Structure source" });
  const originalSource = await source.inputValue();
  const codeBefore = await assertDocked(choice, ratio);
  await choice.getByRole("button", { name: "Expand language editor", exact: true }).click();
  const codeExpanded = await assertFullscreen(choice);
  assert(codeExpanded.dock.height >= codeBefore.dock.height, "Advanced expansion must give the source editor more space");
  assert.equal(await source.inputValue(), originalSource);
  await choice.getByRole("button", { name: "Collapse language editor", exact: true }).click();
  await assertDocked(choice, ratio);
  assert.equal(await source.inputValue(), originalSource);
  const authoredSource = originalSource.replace(/<prompt>[\s\S]*?<\/prompt>/, "<prompt>Preserve this authored prompt</prompt>");
  await source.fill(authoredSource);
  await choice.getByRole("status").getByText(/Valid · preview updated/).waitFor();
  await choice.getByRole("button", { name: "Reset to fields", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Replace your code?", exact: true });
  await confirmation.getByRole("button", { name: "Keep", exact: true }).press("Escape");
  await source.waitFor({ state: "visible" });
  assert.equal(await source.inputValue(), authoredSource, "Escape must cancel Reset without losing authored source");
  await source.press("Escape");
  await assertTimelineRestored();
  await page.locator(".tools").getByRole("button", { name: "Edit", exact: true }).click();
  await choice.getByRole("tab", { name: "Advanced", exact: true }).click();
  assert.equal(await source.inputValue(), authoredSource, "Closing and reopening a source panel must preserve its content");
  await choice.getByRole("button", { name: "Close", exact: true }).click();
  await collapseSelection();

  for (const [width, height] of [[320, 568], [430, 568]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await assertDocked(more, ratio);
    await assertCompactChrome(more);
    await assertFullscreenRoundTrip(more, ratio);
    await separator.focus();
    await separator.press("Home");
    await assertFullscreen(more);
    await dragBy(70, true, true);
    await assertFullscreen(more);
    await page.setViewportSize({ width, height: height + 96 });
    await assertFullscreen(more);
    await page.setViewportSize({ width, height });
    await assertFullscreen(more);
    await separator.press("End");
    await assertTimelineRestored();
  }
  await page.setViewportSize({ width: 430, height: 850 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await assertDocked(more, ratio);
  const handle = await separator.boundingBox();
  assert(handle);
  layout = await geometry();
  const dismissAnimations = await dragBy(layout.app.bottom - handle.y - handle.height / 2 - 2);
  assert(dismissAnimations > 0, "Returning to the timeline should animate when motion is allowed");
  await assertTimelineRestored();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await assertDocked(more, ratio);
  await assertFullscreenRoundTrip(more, ratio);
  const transitions = await page.locator(".editorWorkspace, .editorDock").evaluateAll(elements => elements.flatMap(element =>
    getComputedStyle(element).transitionDuration.split(",").map(value => parseFloat(value))));
  assert(transitions.every(duration => duration <= 0.01), "Reduced motion must suppress workspace resize animation");
  if (process.env.PVO_SHEET_DOCK_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SHEET_DOCK_SCREENSHOT });
  await separator.focus();
  await separator.press("End");
  await assertTimelineRestored();
  assert.deepEqual(errors, [], "The editor should have no browser errors");
  console.log("Sheet dock passed: compact chrome, progressive full-screen expansion/restoration, retained media and playback, camera modality, AI hit targets, non-overlap, ratio, keyboard, scroll isolation, retained text, Advanced, playhead restoration, short viewports and reduced motion.");
} catch (error) {
  console.error(`Sheet dock failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1600)}`);
  if (process.env.PVO_SHEET_DOCK_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SHEET_DOCK_SCREENSHOT }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
