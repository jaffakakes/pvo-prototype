import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await launchBrowser({
  headless: true,
});
const artifacts =
  process.env.PVO_EDITOR_ARTIFACTS || "/tmp/restyle-component-selection";
await mkdir(artifacts, { recursive: true });
const errors = [];
try {
  for (const [width, height, theme] of [
    [320, 693, "light"],
    [393, 852, "light"],
    [430, 932, "dark"],
    [1440, 900, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5191/", {
      waitUntil: "networkidle",
    });
    await page.evaluate(
      async ({ theme, mediaPath }) => {
        document.documentElement.dataset.theme = theme;
        const { useCapture, mkClip } = await import("/src/store.ts");
        window.layerCapture = useCapture;
        const media = await fetch(new URL(mediaPath, location.href)).then(
          (response) => response.blob(),
        );
        const clip = mkClip(8, URL.createObjectURL(media), 0);
        const scene = {
          id: "main",
          name: "Main",
          parent: null,
          clips: [clip],
          texts: [],
          components: [],
          muted: true,
          music: null,
          layers: ["video"],
        };
        useCapture.getState().patch({
          localId: "component-layer-fixture",
          scenes: [scene],
          currentSceneId: "main",
          clips: [clip],
          texts: [],
          components: [],
          audioClips: [],
          layers: ["video"],
          screen: "editor",
          t: 1,
          sel: -1,
          selComp: null,
          selText: null,
          selAudio: null,
          sheet: null,
          playing: false,
          tryMode: null,
          past: [],
          future: [],
        });
        useCapture.getState().addComponent("form");
        await document.fonts.ready;
      },
      {
        theme,
        mediaPath: `/@fs/${fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)).replaceAll("\\", "/")}`,
      },
    );
    if (width >= 1024) {
      await page.locator("[data-desktop-editor]").waitFor();
      await page.screenshot({ path: `${artifacts}/desktop.png` });
      await context.close();
      continue;
    }
    const tools = page.getByRole("toolbar", { name: "Form tools" });
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(await tools.getByRole("button").count(), 6);
    assert.equal(await page.locator("[data-component-page]").count(), 0);
    const overlay = page.locator("[data-preview-component]");
    const before = await page.locator(".pvBox").boundingBox();
    const previewEye = await page
      .getByRole("button", { name: "Try", exact: true })
      .boundingBox();
    await tools.getByRole("button", { name: "Opacity", exact: true }).click();
    const control = page.locator('[data-component-control="opacity"]');
    await control.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(await tools.isVisible(), false);
    const after = await page.locator(".pvBox").boundingBox();
    assert(
      after.height > before.height,
      "Focused controls reclaim the header space",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Project settings", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(await control.getByRole("button").count(), 0);
    const closeSheet = page.getByRole("button", {
      name: "Close sheet",
      exact: true,
    });
    assert.deepEqual(await closeSheet.boundingBox(), previewEye);
    const range = page.getByRole("slider", { name: "Opacity", exact: true });
    await range.focus();
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await range.inputValue(), "90");
    const history = await page.evaluate(
      () => window.layerCapture.getState().past.length,
    );
    const box = await range.boundingBox();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      history + 1,
    );
    const savedOpacity = await range.inputValue();
    const savedHistory = await page.evaluate(
      () => window.layerCapture.getState().past.length,
    );
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await range.inputValue(), savedOpacity);
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      savedHistory,
    );
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-opacity.png`,
    });
    await closeSheet.click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    await tools.getByRole("button", { name: "Transform", exact: true }).click();
    await page
      .getByRole("region", { name: "Transform", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(await tools.isVisible(), false);
    assert.equal(await page.locator("[data-transform-handle]").count(), 4);
    await page
      .getByRole("group", { name: "Transform form", exact: true })
      .press("Shift+]");
    assert.match(await overlay.getAttribute("style"), /rotate\(5deg\)/);
    const handle = page.locator('[data-transform-handle][data-corner="br"]');
    const h = await handle.boundingBox();
    const prior = await page.evaluate(
      () => window.layerCapture.getState().past.length,
    );
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 25, h.y + 25, { steps: 5 });
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      prior + 1,
    );
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("button", { name: "Close tool", exact: true }).click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    await tools.getByRole("button", { name: "Timing", exact: true }).click();
    const timingDialog = page.getByRole("dialog", {
      name: "Choose component start",
      exact: true,
    });
    const framePicker = timingDialog.getByRole("slider", {
      name: "Component appears at",
    });
    await framePicker.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(await tools.isVisible(), false);
    assert.equal(
      await timingDialog.locator("header").getByRole("button").count(),
      2,
    );
    assert.deepEqual(await timingDialog.boundingBox(), {
      x: 0,
      y: 0,
      width,
      height,
    });
    const timingHistory = await page.evaluate(
      () => window.layerCapture.getState().past.length,
    );
    const originalCover = await page.evaluate(
      () => window.layerCapture.getState().coverAt,
    );
    const timingGeometry = {
      preview: await timingDialog.locator("[data-cover-only]").boundingBox(),
      strip: await framePicker.boundingBox(),
    };
    const strip = timingGeometry.strip;
    await page.mouse.move(
      strip.x + strip.width * 0.125,
      strip.y + strip.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      strip.x + strip.width * 0.3,
      strip.y + strip.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    const startTime = Number(await framePicker.inputValue());
    assert(startTime > 1);
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      timingHistory,
    );
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      1,
      "Scrubbing is only a draft",
    );
    await page.waitForFunction((time) => {
      const video = document.querySelector(
        "dialog[open] [data-cover-only] video",
      );
      return (
        video?.readyState >= 2 &&
        !video.seeking &&
        Math.abs(video.currentTime - time) < 0.08
      );
    }, startTime);
    assert.equal(
      await timingDialog.locator("[data-preview-component]").count(),
      1,
      "Component is visible at its draft start",
    );
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-timing.png`,
    });
    await timingDialog
      .getByRole("button", { name: "Close timing picker" })
      .click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      timingHistory,
    );
    await page.getByRole("button", { name: "Edit cover", exact: true }).click();
    const coverDialog = page.getByRole("dialog", {
      name: "Choose cover",
      exact: true,
    });
    await coverDialog.waitFor();
    assert.deepEqual(
      {
        preview: await coverDialog.locator("[data-cover-only]").boundingBox(),
        strip: await coverDialog
          .getByRole("slider", { name: "Pick a cover frame" })
          .boundingBox(),
      },
      timingGeometry,
      "Timing and Cover use the exact same screen layout",
    );
    await coverDialog
      .getByRole("button", { name: "Close cover picker" })
      .click();
    await tools.getByRole("button", { name: "Timing", exact: true }).click();
    await framePicker.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(Number(await framePicker.inputValue()), 1);
    await page.mouse.click(
      strip.x + strip.width * 0.3,
      strip.y + strip.height / 2,
    );
    const savedStart = Number(await framePicker.inputValue());
    await timingDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().past.length),
      timingHistory + 1,
    );
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      savedStart,
    );
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].dur,
      ),
      3,
    );
    assert.equal(
      await page.evaluate(() => window.layerCapture.getState().coverAt),
      originalCover,
    );
    await tools.getByRole("button", { name: "Timing", exact: true }).click();
    await framePicker.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(Number(await framePicker.inputValue()), savedStart);
    await framePicker.focus();
    await framePicker.press("Home");
    await page.keyboard.press("Escape");
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      savedStart,
      "Escape discards the draft",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      1,
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components[0].at,
      ),
      savedStart,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await tools.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("[data-component-page]").waitFor();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    await tools.getByRole("button", { name: "Duplicate", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components.length,
      ),
      2,
    );
    await tools.getByRole("button", { name: "Delete", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.layerCapture.getState().components.length,
      ),
      1,
    );
    assert.equal(await tools.count(), 0);
    await page.locator(".compBar").first().click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    await page.keyboard.press("Escape");
    assert.equal(await tools.count(), 0);
    await page.locator(".compBar").first().click();
    await tools.waitFor();
    await page.waitForFunction(
      () => !document.documentElement.dataset.editorMotion,
    );
    await page.screenshot({
      path: `${artifacts}/${width}-${theme}-selected.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Component selection: phone light/dark, desktop, controls, live timing frames, undo grouping, Design return, duplicate/delete, Escape and fit passed.",
  );
} finally {
  await browser.close();
}
