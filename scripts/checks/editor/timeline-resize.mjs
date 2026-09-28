import assert from "node:assert/strict";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createSheetDockChecks } from "../helpers/editor-sheet-dock.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 850 }, hasTouch: true, permissions: [] });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const { settle, geometry, assertFullscreen: assertSheetFullscreen } = createSheetDockChecks(page, context);
const handle = page.getByRole("separator", { name: "Resize timeline", exact: true });
const workspace = page.locator(".editorWorkspace");

async function dragBy(delta, touch = false, cancelled = false) {
  const box = await handle.boundingBox();
  assert(box && box.height >= 12, "The timeline must keep an accessible drag handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (touch) {
    const session = await context.newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 16; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + delta * step / 16 }] });
      }
      await session.send("Input.dispatchTouchEvent", { type: cancelled ? "touchCancel" : "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + delta, { steps: 16 });
    await page.mouse.up();
  }
  await settle();
}

async function assertTimeline(fullscreen = false) {
  await handle.waitFor({ state: "visible" });
  await settle();
  const layout = await geometry();
  assert.equal(await workspace.getAttribute("data-sheet-open"), "false");
  assert.equal(layout.fullscreen, fullscreen);
  assert.equal(await handle.getAttribute("aria-orientation"), "horizontal");
  assert.equal(await page.getByRole("dialog").count(), 0, "The timeline must not create a modal or sheet");
  assert.equal(await page.locator(".sheetScrim:visible").count(), 0);
  const scenes = await page.locator(".scenesRow").boundingBox();
  const tracks = await page.locator(".tl").boundingBox();
  const tools = await page.locator(".toolBar").boundingBox();
  const grabber = await handle.boundingBox();
  assert(scenes && tracks && tools && grabber, "Scene row, tracks, toolbar and grabber must remain visible");
  assert(scenes.y >= grabber.y + grabber.height - 1, "Scenes must remain below the drag handle");
  assert(tracks.y >= scenes.y + scenes.height - 1, "Tracks must not cover the scene row");
  assert(tracks.y + tracks.height <= tools.y + 1, "Tracks must scroll above the toolbar");
  assert(tracks.height >= 40, "Collapsed timeline must retain a usable track viewport");
  assert(Math.abs(tools.y + tools.height - layout.app.bottom) <= 2, "Timeline toolbar must remain pinned to the app bottom");
  assert(layout.documentOverflow <= 2 && layout.app.bottom <= layout.viewportHeight + 2, "The resized timeline must fit the viewport");
  if (fullscreen) {
    assert.deepEqual(layout.visibility, { header: false, preview: false, playback: false });
    assert.deepEqual(layout.inert, { header: true, preview: true, playback: true });
    assert(Math.abs(layout.dock.top - layout.app.top) < 2 && Math.abs(layout.dock.height - layout.app.height) < 2,
      "Full-screen timeline must fill the app");
    assert.equal(await page.evaluate(() => document.fullscreenElement !== null), false);
  } else if (layout.visibility.preview && layout.visibility.playback) {
    assert(layout.previewArea.bottom <= layout.transport.top + 1 && layout.transport.bottom <= layout.dock.top + 1,
      "The timeline must stay below preview and playback");
  }
  return layout;
}

async function collapseSelection() {
  const collapse = page.getByRole("button", { name: /^Collapse (?:text|component|clip) tools$/ });
  if (await collapse.count()) await collapse.click();
  await settle();
}

async function addFixtureLayers() {
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  const choice = page.getByRole("dialog", { name: "Choice", exact: true });
  await choice.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  const outcome = page.getByRole("dialog", { name: /where\?/ });
  await outcome.getByRole("button", { name: /Go to scene/ }).click();
  await outcome.getByRole("button", { name: /New scene/ }).click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.locator(".sceneChip").first().click();
  await collapseSelection();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByRole("dialog", { name: "Add text", exact: true });
  await text.getByRole("textbox", { name: "Text content" }).fill("Timeline resize note");
  await text.getByRole("button", { name: "Add", exact: true }).click();
  for (let count = 0; count < 4; count++) {
    await page.locator(".tools").getByRole("button", { name: "Duplicate", exact: true }).click();
  }
  await collapseSelection();
  assert.equal(await page.locator(".sceneChip").count(), 2);
  assert.equal(await page.locator(".textBar").count(), 5);
}

async function rowHeights() {
  return page.locator(".tlClip, .textBar, .layerName").evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().height));
}

async function screenshot(stage) {
  if (!process.env.PVO_TIMELINE_RESIZE_SCREENSHOT) return;
  const output = parse(process.env.PVO_TIMELINE_RESIZE_SCREENSHOT);
  await page.screenshot({ path: join(output.dir, `${output.name}-${stage}.png`) });
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await addFixtureLayers();
  await page.evaluate(() => document.fonts.ready);
  const defaultLayout = await assertTimeline();
  const naturalRows = await rowHeights();
  await handle.press("End");
  const minimum = await assertTimeline();
  assert(minimum.dock.height < defaultLayout.dock.height, "End must collapse to a usable minimum");
  const minimumHandle = await handle.boundingBox();
  await dragBy(minimum.app.bottom - minimumHandle.y - minimumHandle.height / 2 - 2);
  assert(Math.abs((await assertTimeline()).dock.height - minimum.dock.height) < 2,
    "Dragging below the minimum must keep a usable timeline instead of dismissing it");
  await handle.press("ArrowUp");
  const keyboardUp = await assertTimeline();
  assert(keyboardUp.dock.height > minimum.dock.height, "ArrowUp must expand the timeline");
  await handle.press("ArrowDown");
  assert(Math.abs((await assertTimeline()).dock.height - minimum.dock.height) < 2);
  await handle.press("Escape");
  assert(Math.abs((await assertTimeline()).dock.height - defaultLayout.dock.height) < 2,
    "Escape must restore default height without dismissing the timeline");
  await handle.press("End");
  await assertTimeline();
  await dragBy(-70, true);
  const touched = await assertTimeline();
  assert(touched.dock.height > minimum.dock.height + 40, "Touch dragging upward must grow the timeline");
  await dragBy(35);
  const partial = await assertTimeline();
  assert(partial.dock.height < touched.dock.height - 20, "Mouse dragging downward must shrink the timeline");
  await dragBy(-50, true, true);
  assert(Math.abs((await assertTimeline()).dock.height - partial.dock.height) < 2, "Cancelling must restore timeline height");
  assert.equal(await workspace.getAttribute("data-resizing"), "false");

  const video = await page.locator(".pvVideo").elementHandle();
  assert(video);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.currentTime > 0.05);
  const timeBefore = await video.evaluate(element => element.currentTime);
  const box = await handle.boundingBox();
  await dragBy(partial.app.top + 1 - box.y - box.height / 2, true);
  const full = await assertTimeline(true);
  assert.deepEqual(await rowHeights(), naturalRows, "Timeline rows must keep their natural heights rather than scale vertically");
  const hiddenPlayback = await video.evaluate(element => ({ same: element === document.querySelector(".pvVideo"), paused: element.paused, time: element.currentTime }));
  assert(hiddenPlayback.same && !hiddenPlayback.paused && hiddenPlayback.time > timeBefore,
    "Full-screen timeline must preserve the video element and advancing playback");
  await screenshot("fullscreen");
  await dragBy(full.dock.height - partial.dock.height);
  await assertTimeline();
  const restoredPlayback = await video.evaluate(element => ({ same: element === document.querySelector(".pvVideo"), paused: element.paused, time: element.currentTime }));
  assert(restoredPlayback.same && !restoredPlayback.paused && restoredPlayback.time > hiddenPlayback.time);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await video.dispose();
  // The last authored operation duplicated one text layer; resizing must not add history entries.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator(".textBar").count(), 4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await page.locator(".textBar").count(), 5);
  assert(Math.abs((await assertTimeline()).dock.height - partial.dock.height) < 2);

  const track = page.locator(".tl");
  await handle.press("End");
  const beforeScroll = await assertTimeline();
  assert(await track.evaluate(element => element.scrollHeight > element.clientHeight + 20), "Fixture tracks must overflow at minimum height");
  await track.hover();
  await page.mouse.wheel(0, 160);
  await page.waitForFunction(() => document.querySelector(".tl").scrollTop > 0);
  assert(Math.abs((await assertTimeline()).dock.height - beforeScroll.dock.height) < 2, "Track scrolling must not resize the timeline");
  const textLayer = page.getByRole("button", { name: "Select text layer: Timeline resize note", exact: true }).first();
  await textLayer.click();
  await page.locator(".tools").getByRole("button", { name: "Edit text", exact: true }).waitFor();
  assert(Math.abs((await assertTimeline()).dock.height - beforeScroll.dock.height) < 2, "Selecting a layer must not resize the timeline");
  const layerOrder = () => page.locator(".layerName").evaluateAll(elements => elements.map(element => element.dataset.reorderLayer));
  const originalOrder = await layerOrder();
  await textLayer.press("Alt+ArrowDown");
  assert.notDeepEqual(await layerOrder(), originalOrder, "Layer keyboard reordering must remain available inside the resized timeline");
  assert(Math.abs((await assertTimeline()).dock.height - beforeScroll.dock.height) < 2, "Reordering layers must not resize their viewport");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await layerOrder(), originalOrder);
  await collapseSelection();
  await page.locator(".tlClip").first().click();
  await page.locator(".tools").getByRole("button", { name: "Split", exact: true }).waitFor();
  assert(Math.abs((await assertTimeline()).dock.height - beforeScroll.dock.height) < 2, "Selecting a clip must not resize the timeline");
  await collapseSelection();
  await dragBy(-90);
  const retained = await assertTimeline();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const more = page.getByRole("dialog", { name: "More", exact: true });
  const sheetHandle = page.getByRole("separator", { name: "Resize editing panel", exact: true });
  await sheetHandle.press("Home");
  await assertSheetFullscreen(more);
  await sheetHandle.press("Escape");
  assert(Math.abs((await assertTimeline()).dock.height - retained.dock.height) < 2,
    "Closing an independently expanded sheet must restore the chosen timeline height");
  await screenshot("partial");

  for (const [width, height] of [[320, 568], [430, 568]]) {
    await page.setViewportSize({ width, height });
    await handle.press("End");
    await assertTimeline();
    await handle.press("Home");
    await assertTimeline(true);
    if (width === 320) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await more.waitFor({ state: "visible" });
      await more.getByRole("button", { name: "Close", exact: true }).click();
      await assertTimeline(true);
    }
    await screenshot(`fullscreen-${width}x${height}`);
    await page.setViewportSize({ width, height: height + 80 });
    await assertTimeline(true);
    await page.setViewportSize({ width, height });
    await assertTimeline(true);
    await dragBy(75, true, true);
    await assertTimeline(true);
    await handle.press("Escape");
    await assertTimeline();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await handle.press("Home");
  await assertTimeline(true);
  const durations = await workspace.evaluate(element => getComputedStyle(element).transitionDuration.split(",").map(parseFloat));
  assert(durations.every(duration => duration <= 0.01), "Reduced motion must suppress timeline resize animation");
  await handle.press("End");
  await assertTimeline();
  assert.deepEqual(errors, [], "The editor should have no browser errors");
  console.log("Timeline resize passed: touch/mouse/keyboard, full-screen restoration, pinned controls, natural row heights, scrolling, selection, independent sheet sizing, retained media/history, short viewports and reduced motion.");
} catch (error) {
  console.error(`Timeline resize failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1600)}`);
  await screenshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
