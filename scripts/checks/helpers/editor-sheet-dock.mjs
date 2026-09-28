import assert from "node:assert/strict";
import { join, parse } from "node:path";

/** Browser geometry and gestures for the dock's progressive layout modes. */
export function createSheetDockChecks(page, context) {
  const workspace = page.locator(".editorWorkspace");
  const separator = page.getByRole("separator", { name: "Resize editing panel", exact: true });

  async function settle() {
    await workspace.evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  async function geometry() {
    return page.evaluate(() => {
      const element = selector => {
        const found = document.querySelector(selector);
        if (!found) throw new Error(`Missing layout region: ${selector}`);
        return found;
      };
      const rect = target => {
        const { top, bottom, left, right, width, height } = target.getBoundingClientRect();
        return { top, bottom, left, right, width, height };
      };
      const visible = target => getComputedStyle(target).visibility !== "hidden"
        && target.getBoundingClientRect().height > 0;
      const header = element(".editorHead");
      const preview = element(".pvBox");
      const playback = element(".transport");
      const workspace = element(".editorWorkspace");
      return {
        app: rect(element(".app")), previewArea: rect(element(".previewArea")), preview: rect(preview),
        header: rect(header), transport: rect(playback), dock: rect(element(".editorDock")),
        headerRegion: rect(header.closest("[data-visible]")), playbackRegion: rect(playback.closest("[data-visible]")),
        visibility: { header: visible(header), preview: visible(preview), playback: visible(playback) },
        inert: { header: !!header.closest("[inert]"), preview: !!preview.closest("[inert]"), playback: !!playback.closest("[inert]") },
        fullscreen: workspace.dataset.panelFullscreen === "true",
        previewVisible: workspace.dataset.previewVisible === "true",
        playbackVisible: workspace.dataset.playbackVisible === "true",
        viewportHeight: window.visualViewport?.height ?? innerHeight,
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });
  }

  async function assertDocked(dialog, ratio, fullscreen = false) {
    await dialog.waitFor({ state: "visible" });
    await settle();
    const layout = await geometry();
    const box = await dialog.boundingBox();
    assert(box, "Editing panel must have visible bounds");
    assert.equal(await dialog.getAttribute("aria-modal"), null, "An editor panel must remain a layout panel");
    assert.equal(await separator.getAttribute("aria-orientation"), "horizontal");
    assert.equal(await page.locator(".sheetScrim:visible").count(), 0, "Docked controls must not add a scrim");
    for (const selector of [".tl", ".scenesRow", ".toolBar"]) {
      assert.equal(await page.locator(`${selector}:visible`).count(), 0, `${selector} should be replaced by the panel`);
    }
    assert.equal(layout.fullscreen, fullscreen, "Panel layout mode should match the requested size");
    assert.equal(layout.previewVisible, layout.visibility.preview, "Preview visibility must match its layout state");
    assert.equal(layout.playbackVisible, layout.visibility.playback, "Playback visibility must match its layout state");
    assert(box.y + box.height <= layout.app.bottom + 2, "Editing panel escapes the app bottom");
    assert(layout.app.bottom <= layout.viewportHeight + 2 && layout.documentOverflow <= 2, "The workspace must fit the viewport");
    if (!fullscreen) {
      assert.deepEqual(layout.visibility, { header: true, preview: true, playback: true }, "Partial panels must show the editor chrome");
      assert(layout.previewArea.bottom <= layout.transport.top + 1, "Preview and transport overlap");
      assert(layout.transport.bottom <= box.y + 1, "Editing controls overlap the transport");
      assert(layout.preview.top >= layout.previewArea.top - 1 && layout.preview.bottom <= layout.previewArea.bottom + 1,
        `Preview escapes its available space: ${JSON.stringify(layout)}`);
      assert(layout.preview.width > 0 && layout.preview.height > 0, "The player must remain visible in a partial panel");
      assert(Math.abs(layout.preview.width / layout.preview.height - ratio) < 0.02, "Resizing must preserve the selected video ratio");
    }
    return layout;
  }

  async function assertFullscreen(dialog) {
    const layout = await assertDocked(dialog, undefined, true);
    assert.deepEqual(layout.visibility, { header: false, preview: false, playback: false }, "A full-screen panel must hide all editor chrome");
    assert.deepEqual(layout.inert, { header: true, preview: true, playback: true }, "Hidden editor chrome must be inert");
    assert(Math.abs(layout.dock.top - layout.app.top) < 2 && Math.abs(layout.dock.height - layout.app.height) < 2,
      `The expanded dock must fill the entire app: ${JSON.stringify(layout)}`);
    assert(layout.headerRegion.height <= 1 && layout.playbackRegion.height <= 1,
      "Hidden header and playback regions must release their layout space");
    assert.equal(await page.evaluate(() => document.fullscreenElement !== null), false,
      "Panel expansion must use app layout without entering native browser fullscreen");
    return layout;
  }

  async function dragBy(delta, touch = false, cancel = false) {
    const handle = await separator.boundingBox();
    assert(handle && handle.height >= 12, "The editing panel needs a usable drag handle");
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    if (touch) {
      const session = await context.newCDPSession(page);
      try {
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let step = 1; step <= 12; step++) {
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + delta * step / 12 }] });
        }
        await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
      } finally {
        await session.detach();
      }
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + delta, { steps: 12 });
      await page.mouse.up();
    }
    const animations = await workspace.evaluate(element => element.getAnimations({ subtree: true }).length);
    await settle();
    return animations;
  }

  async function assertCompactChrome(dialog) {
    const layout = await geometry();
    const header = await dialog.locator(".sheetHead").boundingBox();
    const handle = await separator.boundingBox();
    assert(header && handle, "The editing panel needs a visible grip, title and close control");
    const chromeHeight = header.y + header.height - layout.dock.top;
    assert(chromeHeight <= handle.height + 61,
      `The More header should stay compact alongside its pointer-appropriate grip, got ${chromeHeight}px`);
  }

  async function sampleDrag(endY) {
    const handle = await separator.boundingBox();
    assert(handle);
    const x = handle.x + handle.width / 2;
    const startY = handle.y + handle.height / 2;
    const samples = [await geometry()];
    await page.mouse.move(x, startY);
    await page.mouse.down();
    try {
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(x, startY + (endY - startY) * step / 40);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        samples.push(await geometry());
      }
    } finally {
      await page.mouse.up();
    }
    await settle();
    samples.push(await geometry());
    return samples;
  }

  function assertProgressiveVisibility(samples, expanding) {
    assert(samples.some(({ visibility }) => !visibility.preview && visibility.playback),
      "The preview should disappear before the playback controls");
    assert(samples.some(({ visibility }) => !visibility.playback && visibility.header),
      "Playback should disappear before the Edit header");
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1];
      const current = samples[index];
      for (const region of ["preview", "playback", "header"]) {
        if (expanding) assert(previous.visibility[region] || !current.visibility[region], `${region} must not reappear during upward dragging`);
        else assert(!previous.visibility[region] || current.visibility[region], `${region} must not disappear during downward dragging`);
      }
      assert(!current.visibility.preview || current.visibility.playback, "Preview restoration must follow playback restoration");
      assert(!current.visibility.playback || current.visibility.header, "Playback restoration must follow header restoration");
      const growth = current.dock.height - previous.dock.height;
      assert(expanding ? growth >= -2 : growth <= 2, "Panel movement must stay in the drag direction");
    }
  }

  async function captureFullscreen() {
    if (!process.env.PVO_SHEET_DOCK_SCREENSHOT) return;
    const output = parse(process.env.PVO_SHEET_DOCK_SCREENSHOT);
    const viewport = page.viewportSize();
    await page.screenshot({ path: join(output.dir, `${output.name}-fullscreen-${viewport.width}x${viewport.height}.png`) });
  }

  async function assertFullscreenRoundTrip(dialog, ratio, playing = false, snapNearTop = false) {
    const initial = await assertDocked(dialog, ratio);
    const video = await page.locator(".pvVideo").elementHandle();
    assert(video, "The fixture must keep a mounted video element");
    const initialTime = await video.evaluate(element => element.currentTime);
    const upward = await sampleDrag(Math.max(1, initial.app.top + (snapNearTop ? 28 : 1)));
    assertProgressiveVisibility(upward, true);
    const full = await assertFullscreen(dialog);
    const beforeRelease = upward.at(-2);
    const releaseGrowth = full.dock.height - beforeRelease.dock.height;
    if (snapNearTop) assert(releaseGrowth > 0 && releaseGrowth <= 26,
      "Releasing within the last 24px should finish expansion without a larger jump");
    else assert(Math.abs(releaseGrowth) < 2, "Releasing at full expansion must not move the panel");
    await captureFullscreen();
    const hiddenMedia = await video.evaluate(element => ({
      sameNode: element === document.querySelector(".pvVideo"), paused: element.paused, time: element.currentTime,
    }));
    assert(hiddenMedia.sameNode, "Full-screen expansion must retain the mounted media element");
    if (playing) assert(!hiddenMedia.paused && hiddenMedia.time > initialTime, "Playback must continue while its preview is hidden");
    const handle = await separator.boundingBox();
    assert(handle && handle.y >= full.app.top - 1 && handle.y + handle.height <= full.app.bottom,
      "The full-screen panel must keep its resize handle onscreen");
    const downward = await sampleDrag(handle.y + handle.height / 2 + full.dock.height - initial.dock.height);
    assertProgressiveVisibility(downward, false);
    const restored = await assertDocked(dialog, ratio);
    assert(Math.abs(restored.dock.height - initial.dock.height) < 2, "Dragging back must restore the chosen panel height");
    const restoredMedia = await video.evaluate(element => ({
      sameNode: element === document.querySelector(".pvVideo"), paused: element.paused, time: element.currentTime,
    }));
    assert(restoredMedia.sameNode, "Restoring the preview must keep the original media element");
    if (playing) assert(!restoredMedia.paused && restoredMedia.time > hiddenMedia.time, "Restoring the preview must preserve advancing playback");
    await video.dispose();
  }

  return { separator, settle, geometry, assertDocked, assertFullscreen, dragBy, assertCompactChrome, assertFullscreenRoundTrip };
}
