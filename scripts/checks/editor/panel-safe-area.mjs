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

const cases = [
  { name: "portrait", width: 430, height: 932, coarse: true, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { name: "landscape", width: 932, height: 430, coarse: true, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
  { name: "standard", width: 430, height: 850, coarse: false, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
];

async function checkSafeArea(testCase) {
  const { name, width, height, coarse, insets } = testCase;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: coarse, isMobile: coarse, permissions: [] });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  const { settle, geometry } = createSheetDockChecks(page, context);
  const workspace = page.locator(".editorWorkspace");

  async function screenshot(stage) {
    if (!process.env.PVO_PANEL_SAFE_AREA_SCREENSHOT) return;
    const output = parse(process.env.PVO_PANEL_SAFE_AREA_SCREENSHOT);
    await page.screenshot({ path: join(output.dir, `${output.name}-${name}-${stage}.png`) });
  }

  async function assertSafeHandle(handle, expectedInsets = insets) {
    const bounds = await handle.boundingBox();
    assert(bounds, `${name}: the active handle must be visible`);
    assert(bounds.height >= (coarse ? 44 : 24), `${name}: the handle needs a usable ${coarse ? "touch" : "mouse"} target`);
    assert(bounds.y >= expectedInsets.top - 1, `${name}: the whole handle must remain below the unsafe top (${JSON.stringify(bounds)})`);
    assert(bounds.x >= expectedInsets.left - 1 && bounds.x + bounds.width <= width - expectedInsets.right + 1,
      `${name}: the whole handle must remain between unsafe side regions`);
    const missedTargets = await handle.evaluate(element => {
      const box = element.getBoundingClientRect();
      const center = box.left + box.width / 2;
      return [center - 20, center + 20].flatMap(x => [box.top + 1, box.bottom - 1].flatMap(y => {
        const hit = document.elementFromPoint(x, y);
        return element.contains(hit) ? [] : [{ x, y, hit: hit?.className, expected: element.className }];
      }));
    });
    assert.equal(missedTargets.length, 0, `${name}: the central handle target must be unobstructed: ${JSON.stringify(missedTargets)}`);
    return bounds;
  }

  async function dragToHeight(handle, targetHeight) {
    const box = await assertSafeHandle(handle);
    const startHeight = Number(await handle.getAttribute("aria-valuenow"));
    const x = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const endY = startY + startHeight - targetHeight;
    assert(endY >= insets.top && endY <= height - insets.bottom,
      `${name}: the gesture itself must stay inside the reachable screen`);
    if (coarse) await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    else { await page.mouse.move(x, startY); await page.mouse.down(); }
    try {
      for (let step = 1; step <= 20; step++) {
        const y = startY + (endY - startY) * step / 20;
        if (coarse) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        else await page.mouse.move(x, y);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        await assertSafeHandle(handle);
      }
    } finally {
      if (coarse) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      else await page.mouse.up();
    }
    await settle();
    await assertSafeHandle(handle);
  }

  async function panelRoundTrip(handle, label) {
    await handle.waitFor({ state: "visible" });
    await settle();
    const initial = Number(await handle.getAttribute("aria-valuenow"));
    const maximum = Number(await handle.getAttribute("aria-valuemax"));
    // Before this fix, 25–58px short of full expansion put the handle under a 59px status area.
    await dragToHeight(handle, maximum - 40);
    assert.equal(await workspace.getAttribute("data-panel-fullscreen"), "false", "Near-full geometry must be tested before snapping");
    await screenshot(`${label}-near-full`);
    await dragToHeight(handle, maximum);
    assert.equal(await workspace.getAttribute("data-panel-fullscreen"), "true");
    const full = await geometry();
    assert(Math.abs(full.dock.top - full.app.top - insets.top) <= 2,
      `${name}: full expansion must start after the top safe area`);
    assert(Math.abs(full.dock.height - (full.app.height - insets.top)) <= 2,
      `${name}: the panel should use all safe vertical space`);
    assert.deepEqual(full.visibility, { header: false, preview: false, playback: false });
    assert.equal(await page.evaluate(() => document.fullscreenElement !== null), false);
    if (name === "portrait" && label === "timeline") {
      const smallerTop = { ...insets, top: 20 };
      await session.send("Emulation.setSafeAreaInsetsOverride", { insets: smallerTop });
      await settle();
      await assertSafeHandle(handle, smallerTop);
      assert.equal(Number(await handle.getAttribute("aria-valuemax")), maximum + insets.top - smallerTop.top,
        "Safe-area changes must update usable full-screen height without resizing the viewport");
      assert.equal(await workspace.getAttribute("data-panel-fullscreen"), "true");
      await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
      await settle();
      await assertSafeHandle(handle);
      assert.equal(Number(await handle.getAttribute("aria-valuemax")), maximum);
    }
    await screenshot(`${label}-full`);
    // Start the return gesture from the actual visible target, not the now-hidden original position.
    await dragToHeight(handle, initial);
    const restored = await geometry();
    assert.deepEqual(restored.visibility, { header: true, preview: true, playback: true },
      `${name}: dragging down must bring the player and playback controls back`);
    assert(Math.abs(Number(await handle.getAttribute("aria-valuenow")) - initial) <= 2,
      `${name}: dragging back must restore the initial panel height`);
  }

  try {
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    const visit = page.getByRole("button", { name: "Visit Site", exact: true });
    if (await visit.isVisible()) await visit.click();
    try {
      await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
    } catch (error) {
      throw new Error(`This regression requires Chromium Emulation.setSafeAreaInsetsOverride: ${error.message}`);
    }
    const measured = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const result = { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
      probe.remove();
      return result;
    });
    assert.deepEqual(measured, insets, "The browser must apply real CSS safe-area environment values");
    assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), coarse);
    await page.locator('input[type="file"]').setInputFiles(videoFile);
    await page.getByRole("button", { name: "Open editor", exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await panelRoundTrip(page.getByRole("separator", { name: "Resize timeline", exact: true }), "timeline");
    const toolbarButtons = await page.locator(".toolBar .tools button").all();
    for (const button of toolbarButtons) {
      const bounds = await button.boundingBox();
      assert(bounds && bounds.y + bounds.height <= height - insets.bottom + 1,
        `${name}: toolbar controls must remain above the bottom safe area`);
    }
    await page.getByRole("button", { name: "More", exact: true }).click();
    const more = page.getByRole("dialog", { name: "More", exact: true });
    await more.waitFor({ state: "visible" });
    await settle();
    const dock = await page.locator(".editorDock").boundingBox();
    const header = await more.locator(".sheetHead").boundingBox();
    assert(header.y + header.height - dock.y <= (coarse ? 110 : 85),
      `${name}: the handle/header should not add excessive empty chrome`);
    await panelRoundTrip(page.getByRole("separator", { name: "Resize editing panel", exact: true }), "sheet");
    await more.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("separator", { name: "Resize timeline", exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(errors, [], `${name}: the editor should have no browser errors`);
    console.log(`Safe-area panel gestures passed: ${name}.`);
  } catch (error) {
    await screenshot("failure").catch(() => {});
    throw error;
  } finally {
    await session.detach();
    await context.close();
  }
}

try {
  for (const testCase of cases) await checkSafeArea(testCase);
  console.log("Panel safe-area regression passed: real CSS insets, safe near-full/full touch targets, reachable return gestures, portrait/landscape and compact zero-inset layout.");
} finally {
  await browser.close();
}
