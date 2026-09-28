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
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, permissions: [] });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const { settle } = createSheetDockChecks(page, context);
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));
const text = page.locator(".textOverlay");
const component = page.locator(".compOverlay");
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function authorBox(target) {
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const preview = document.querySelector(".pvBox").getBoundingClientRect();
    return {
      x: (box.left + box.width / 2 - preview.left) / preview.width,
      y: (box.top + box.height / 2 - preview.top) / preview.height,
      width: box.width / preview.width, height: box.height / preview.height,
    };
  });
}

function assertSameBox(actual, expected, message) {
  for (const key of ["x", "y", "width", "height"]) {
    assert(Math.abs(actual[key] - expected[key]) < 0.006,
      `${message}: ${key}, actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

async function assertPageScale() {
  const scale = await page.evaluate(() => visualViewport?.scale ?? 1);
  assert(Math.abs(scale - 1) < 0.001, `Authoring gestures must not zoom the page (scale ${scale})`);
}

async function centerOf(target) {
  const box = await target.boundingBox();
  assert(box, "The gesture target must be visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pinch({ center, factor, target, translation = { x: 0, y: 0 }, vertical = false, cancel = false, continueDrag = false }) {
  const vector = vertical ? { x: 0, y: 14 } : { x: 14, y: 0 };
  const positions = progress => [0, 1].map(id => ({
    id,
    x: center.x + translation.x * progress + (id ? 1 : -1) * vector.x * (1 + (factor - 1) * progress),
    y: center.y + translation.y * progress + (id ? 1 : -1) * vector.y * (1 + (factor - 1) * progress),
  }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: positions(0) });
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: positions(step / 12) });
  }
  await frames();
  const result = {};
  if (continueDrag) {
    result.beforeLift = await authorBox(target);
    // Chrome accepts a specific lifted contact here; omitting it on touchMove does not release it.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [positions(1)[1]] });
    await frames();
    result.afterLift = await authorBox(target);
    const remaining = positions(1)[0];
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
        ...remaining, x: remaining.x + 10 * step / 8, y: remaining.y + 8 * step / 8,
      }] });
    }
    await frames();
    result.afterSingleMove = await authorBox(target);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  await frames();
  await assertPageScale();
  return result;
}

async function undoRedo(target, before, after) {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await frames();
  assertSameBox(await authorBox(target), before, "One Undo must revert the entire gesture");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await frames();
  assertSameBox(await authorBox(target), after, "One Redo must restore the entire gesture");
}

async function verifyOverlayGestures(target, label) {
  let before = await authorBox(target);
  await pinch({ center: await centerOf(target), factor: 1.55, target });
  let after = await authorBox(target);
  assert(after.width > before.width * 1.25 && after.height > before.height * 1.2, `${label}: spreading fingers must enlarge the overlay`);
  assert(Math.abs(after.x - before.x) < 0.008 && Math.abs(after.y - before.y) < 0.008,
    `${label}: a fixed pinch midpoint must retain the overlay center`);
  await undoRedo(target, before, after);

  before = after;
  await pinch({ center: await centerOf(target), factor: 0.75, target });
  after = await authorBox(target);
  assert(after.width < before.width * 0.9 && after.height < before.height * 0.9, `${label}: bringing fingers together must shrink the overlay`);
  assert(Math.abs(after.x - before.x) < 0.008 && Math.abs(after.y - before.y) < 0.008,
    `${label}: shrinking must retain a stationary midpoint`);
  await undoRedo(target, before, after);

  before = after;
  const preview = await page.locator(".pvBox").boundingBox();
  await pinch({ center: await centerOf(target), factor: 1.05, target, translation: { x: 12, y: 10 } });
  after = await authorBox(target);
  assert(Math.abs((after.x - before.x) * preview.width - 12) < 3
    && Math.abs((after.y - before.y) * preview.height - 10) < 3, `${label}: overlay position must follow midpoint translation`);
  await undoRedo(target, before, after);

  await pinch({ center: await centerOf(target), factor: 1.3, target, translation: { x: 9, y: 7 }, cancel: true });
  assertSameBox(await authorBox(target), after, `${label}: cancellation must roll back the in-progress gesture`);
  await undoRedo(target, before, after);

  before = after;
  const transition = await pinch({ center: await centerOf(target), factor: 1.15, target, continueDrag: true });
  assertSameBox(transition.afterLift, transition.beforeLift, `${label}: lifting one finger must not jump`);
  assert(Math.abs(transition.afterSingleMove.width - transition.afterLift.width) < 0.006
    && Math.abs(transition.afterSingleMove.height - transition.afterLift.height) < 0.006,
  `${label}: the remaining finger must move without further scaling: ${JSON.stringify(transition)}`);
  assert(Math.abs((transition.afterSingleMove.x - transition.afterLift.x) * preview.width - 10) < 3
    && Math.abs((transition.afterSingleMove.y - transition.afterLift.y) * preview.height - 8) < 3,
  `${label}: the remaining finger must continue dragging from a fresh anchor`);
  after = await authorBox(target);
  await undoRedo(target, before, after);
  assert.equal(await page.getByRole("dialog").count(), 0, "A completed pinch must not be treated as a tap to edit");
  return { before, after };
}

async function collapseSelection() {
  const button = page.getByRole("button", { name: /^Collapse (?:text|component|clip) tools$/ });
  if (await button.count()) await button.click();
  await settle();
}

async function snapshotOverlays() {
  return { text: await authorBox(text), component: await authorBox(component) };
}

async function assertOverlaysUnchanged(expected, message) {
  const actual = await snapshotOverlays();
  assertSameBox(actual.text, expected.text, `${message}: text`);
  assertSameBox(actual.component, expected.component, `${message}: component`);
}

async function scrollStyleSheet() {
  const layer = page.getByRole("button", { name: "Select text layer: Pinch", exact: true });
  await layer.click();
  await page.locator(".tools").getByRole("button", { name: "Edit text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit text", exact: true });
  await dialog.getByRole("tab", { name: "Style", exact: true }).click();
  const scroller = dialog.locator("[data-sheet-body]");
  await settle();
  assert(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 40));
  const box = await scroller.boundingBox();
  const center = { x: box.x + 8, y: box.y + box.height / 2 };
  await pinch({ center, factor: 1.7, vertical: true });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: center.x, y: box.y + box.height - 20 }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
      id: 0, x: center.x, y: box.y + box.height - 20 - (box.height - 40) * step / 12,
    }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.querySelector("[data-sheet-body]").scrollTop > 10);
  await assertPageScale();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await settle();
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const addText = page.getByRole("dialog", { name: "Add text", exact: true });
  await addText.getByRole("textbox", { name: "Text content" }).fill("Pinch");
  await addText.getByRole("button", { name: "Add", exact: true }).click();
  await settle();
  const originalVideoTransform = await page.locator(".pvVideo").evaluate(element => element.style.transform);
  await verifyOverlayGestures(text, "Text");
  const textAfterGestures = await authorBox(text);
  await collapseSelection();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Add a note" }).click();
  await page.getByRole("dialog", { name: "Note", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await settle();
  const componentHistory = await verifyOverlayGestures(component, "Component");
  assertSameBox(await authorBox(text), textAfterGestures, "Component gestures must not resize or move the text");
  assert.equal(await page.locator(".pvVideo").evaluate(element => element.style.transform), originalVideoTransform,
    "Overlay gestures must not change video scaling");
  const expected = await snapshotOverlays();
  await pinch({ center: await centerOf(page.locator(".editorHead h1")), factor: 1.7 });
  await assertOverlaysUnchanged(expected, "Pinching app chrome must not edit overlays");
  await scrollStyleSheet();
  await assertOverlaysUnchanged(expected, "Pinching and scrolling a sheet must not edit overlays");

  await page.locator(".editorHead").getByRole("button", { name: "Try", exact: true }).click();
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  if (await pause.isVisible()) await pause.click();
  await component.waitFor({ state: "visible" });
  await pinch({ center: await centerOf(component), factor: 1.6 });
  await page.locator(".editorHead").getByRole("button", { name: "Stop", exact: true }).click();
  await settle();
  await assertOverlaysUnchanged(expected, "Try mode must not perform authoring mutations");
  // Chrome, sheet, scrolling and Try interactions must not add authored history entries either.
  await undoRedo(component, componentHistory.before, componentHistory.after);
  assert.deepEqual(errors, [], "The editor should have no browser errors");
  if (process.env.PVO_PREVIEW_GESTURES_SCREENSHOT) await page.screenshot({ path: process.env.PVO_PREVIEW_GESTURES_SCREENSHOT });
  console.log("Preview gestures passed: text/component grow/shrink, midpoint movement, atomic Undo/Redo, cancellation, two-to-one continuity, page zoom prevention, native sheet scrolling and Try isolation.");
} catch (error) {
  console.error(`Preview gestures failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1400)}`);
  if (process.env.PVO_PREVIEW_GESTURES_SCREENSHOT) await page.screenshot({ path: process.env.PVO_PREVIEW_GESTURES_SCREENSHOT }).catch(() => {});
  process.exitCode = 1;
} finally {
  await cdp.detach();
  await context.close();
  await browser.close();
}
