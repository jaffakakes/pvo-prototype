import assert from "node:assert/strict";

/** Browser geometry for the editor's fixed player/tool split. */
export function createSheetDockChecks(page) {
  const workspace = page.locator(".editorWorkspace");

  async function settle() {
    await workspace.evaluate(async (element) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  }

  async function geometry() {
    return page.evaluate(() => {
      const element = (selector) => {
        const found = document.querySelector(selector);
        if (!found) throw new Error(`Missing layout region: ${selector}`);
        return found;
      };
      const rect = (target) => {
        const { top, bottom, left, right, width, height } =
          target.getBoundingClientRect();
        return { top, bottom, left, right, width, height };
      };
      const visible = (target) =>
        getComputedStyle(target).visibility !== "hidden" &&
        target.getBoundingClientRect().height > 0;
      const header = element(".editorHead");
      const preview = element(".pvBox");
      const playback = element(".transport");
      const workspace = element(".editorWorkspace");
      return {
        app: rect(element(".app")),
        previewArea: rect(element(".previewArea")),
        preview: rect(preview),
        header: rect(header),
        transport: rect(playback),
        dock: rect(element(".editorDock")),
        headerRegion: rect(header.closest("[data-visible]")),
        playbackRegion: rect(playback.closest("[data-visible]")),
        visibility: {
          header: visible(header.querySelector("button")),
          preview: visible(preview),
          playback: visible(playback),
        },
        inert: {
          header: !!header.closest("[inert]"),
          preview: !!preview.closest("[inert]"),
          playback: !!playback.closest("[inert]"),
        },
        fullscreen: workspace.dataset.panelFullscreen === "true",
        previewVisible: workspace.dataset.previewVisible === "true",
        playbackVisible: workspace.dataset.playbackVisible === "true",
        viewportHeight: window.visualViewport?.height ?? innerHeight,
        documentOverflow:
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight,
      };
    });
  }

  async function assertDocked(dialog, ratio) {
    await dialog.waitFor({ state: "visible" });
    await settle();
    const layout = await geometry();
    const box = await dialog.boundingBox();
    assert(box, "Editing panel must have visible bounds");
    assert.equal(
      await dialog.getAttribute("aria-modal"),
      null,
      "An editor panel must remain a layout panel",
    );
    assert.equal(
      await page.locator(".sheetScrim:visible").count(),
      0,
      "Docked controls must not add a scrim",
    );
    for (const selector of [".tl", ".scenesRow", ".toolBar"]) {
      assert.equal(
        await page.locator(`${selector}:visible`).count(),
        0,
        `${selector} should be replaced by the panel`,
      );
    }
    assert.equal(
      await page
        .getByRole("separator", { name: /^Resize (timeline|editing panel)$/ })
        .count(),
      0,
      "Editing panels have no resize controls",
    );
    assert(
      Math.abs(
        layout.dock.height * 3 -
          (layout.previewArea.height + layout.transport.height),
      ) < 2,
      "Player and tools must use a fixed 75/25 split",
    );
    assert.equal(
      layout.previewVisible,
      layout.visibility.preview,
      "Preview visibility must match its layout state",
    );
    assert.equal(
      layout.playbackVisible,
      layout.visibility.playback,
      "Playback visibility must match its layout state",
    );
    assert(
      box.y + box.height <= layout.app.bottom + 2,
      "Editing panel escapes the app bottom",
    );
    assert(
      layout.app.bottom <= layout.viewportHeight + 2 &&
        layout.documentOverflow <= 2,
      "The workspace must fit the viewport",
    );
    assert.deepEqual(
      layout.visibility,
      { header: true, preview: true, playback: true },
      "Partial panels must show the editor chrome",
    );
    assert(
      layout.previewArea.bottom <= layout.transport.top + 1,
      "Preview and transport overlap",
    );
    assert(
      layout.transport.bottom <= box.y + 1,
      "Editing controls overlap the transport",
    );
    assert(
      layout.preview.top >= layout.previewArea.top - 1 &&
        layout.preview.bottom <= layout.previewArea.bottom + 1,
      `Preview escapes its available space: ${JSON.stringify(layout)}`,
    );
    assert(
      layout.preview.width > 0 && layout.preview.height > 0,
      "The player must remain visible in a partial panel",
    );
    assert(
      Math.abs(layout.preview.width / layout.preview.height - ratio) < 0.02,
      "Resizing must preserve the selected video ratio",
    );

    return layout;
  }

  async function assertCompactChrome(dialog) {
    const layout = await geometry();
    const header = await dialog.locator(".sheetHead").boundingBox();
    assert(
      header && header.y + header.height - layout.dock.top <= 85,
      "The panel header stays compact without a resize grip",
    );
  }

  return { settle, geometry, assertDocked, assertCompactChrome };
}
