import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(10000);
const widthField = page.getByRole("spinbutton", { name: "Width (px)", exact: true });
const heightField = page.getByRole("spinbutton", { name: "Height (px)", exact: true });
const settle = () => page.evaluate(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  await frame();
  await frame();
  await Promise.all((document.querySelector(".pvBox")?.getAnimations() ?? []).map(animation => animation.finished.catch(() => {})));
  await frame();
  await frame();
});
const history = () => page.evaluate(() => window.sizeCapture.getState().past.length);

async function box() {
  await settle();
  return page.locator(".compOverlay").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const preview = document.querySelector(".pvBox").getBoundingClientRect();
    return {
      width: bounds.width / preview.width, height: bounds.height / preview.width,
      x: (bounds.left + bounds.width / 2 - preview.left) / preview.width,
      y: (bounds.top + bounds.height / 2 - preview.top) / preview.height,
    };
  });
}

function same(actual, expected, label) {
  for (const key of Object.keys(expected)) {
    assert(Math.abs(actual[key] - expected[key]) < .004, `${label}: ${key} ${actual[key]} vs ${expected[key]}`);
  }
}

async function setSize(field, value, key = "Enter") {
  await field.fill(String(value));
  await field.press(key);
  await settle();
}

async function reselectComponentLook() {
  await page.locator('[data-desktop-timeline] button[data-kind="component"]').click();
  await page.getByRole("tab", { name: "Look", exact: true }).click();
  await widthField.waitFor();
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    window.sizeCapture = (await import("/src/store.ts")).useCapture;
    const clip = { id: 1, url: null, color: "#4d4257", srcDur: 20, in: 0, out: 20, speed: 1, zoom: 1, mirror: false, width: 720, height: 1280, fit: "cover" };
    const scene = { id: "main", name: "Main", parent: null, clips: [clip], texts: [], components: [], muted: true, sound: -1, layers: ["video"] };
    window.sizeCapture.getState().patch({ scenes: [scene], currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"], screen: "editor", sheet: null, selComp: null, t: 4, past: [], future: [] });
    await document.fonts.ready;
  });
  for (const type of ["tooltip", "card", "choice", "form"]) {
    await page.evaluate(type => {
      const state = window.sizeCapture.getState();
      for (const component of state.components) state.deleteComponent(component.id);
      const id = state.addComponent(type);
      state.updateComponent(id, { x: 50, y: 40 });
    }, type);
    await page.getByRole("tab", { name: "Look", exact: true }).click();
    const original = await box();
    const before = await history();
    assert.equal(Number(await widthField.inputValue()), Math.round(original.width * 1080));
    await setSize(widthField, 300);
    const narrower = await box();
    same(narrower, { ...original, width: 300 / 1080 }, `${type}: only width changes`);
    assert.equal(await history(), before + 1, "One field edit is one undo entry");
    await setSize(heightField, 160, "Tab");
    const taller = await box();
    same(taller, { ...narrower, height: 160 / 1080 }, `${type}: only height changes`);
    await page.getByRole("button", { name: "Undo · Ctrl/⌘ Z", exact: true }).click();
    same(await box(), narrower, "Undo restores height");
    assert.equal(await widthField.count(), 0, "Desktop undo clears the selection");
    await reselectComponentLook();
    assert.equal(Number(await heightField.inputValue()), Math.round(original.height * 1080));
    await page.getByRole("button", { name: "Redo · Ctrl/⌘ Shift Z", exact: true }).click();
    same(await box(), taller, "Redo restores height");
    assert.equal(await widthField.count(), 0, "Desktop redo clears the selection");
    await reselectComponentLook();
    const unchanged = await history();
    await setSize(widthField, "");
    await setSize(heightField, 200, "Escape");
    assert.equal(await history(), unchanged, "Empty and cancelled edits do not change history");
    same(await box(), taller, "Empty and cancelled edits retain size");
    await page.setViewportSize({ width: 1024, height: 768 });
    await widthField.waitFor();
    same(await box(), taller, "Tablet retains canvas pixel dimensions");
    assert.equal(await widthField.inputValue(), "300");
    assert.equal(await heightField.inputValue(), "160");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Back to camera" }).waitFor();
    assert.equal(await widthField.count(), 0, "Mobile keeps its existing controls");
    same(await box(), taller, "Mobile retains canvas pixel dimensions");
    await page.setViewportSize({ width: 1440, height: 960 });
    await widthField.waitFor();
    await setSize(widthField, 99999);
    assert.equal(await widthField.inputValue(), "16384");
    await setSize(heightField, -1);
    assert.equal(await heightField.inputValue(), "1");
    await page.getByRole("button", { name: "Reset size", exact: true }).click();
    same(await box(), original, "Reset restores original dimensions");
    console.log(`PASS: ${type} independent dimensions, history, validation and responsive controls.`);
  }
  // The same host geometry must also work when appearance is owned by PVO code.
  await page.evaluate(async () => {
    const { takeOverWithCode } = await import("/src/domain/components/codeOwnership.ts");
    const state = window.sizeCapture.getState();
    const component = state.components[0];
    state.updateComponent(component.id, takeOverWithCode(component));
  });
  await page.locator('.compCustomRuntime iframe[title^="Component "]').waitFor();
  await page.waitForTimeout(500);
  const originalCode = await box();
  await setSize(widthField, 420);
  await setSize(heightField, 360);
  same(await box(), { ...originalCode, width: 420 / 1080, height: 360 / 1080 }, "Code-owned component resizing");
  if (process.env.COMPONENT_SIZE_SCREENSHOT) await page.screenshot({ path: process.env.COMPONENT_SIZE_SCREENSHOT });

  const playerSize = await page.evaluate(async root => {
    const { createOverlayRenderer } = await import(`/@fs/${root}player/components/overlays.js`);
    const { registerComponentView } = await import(`/@fs/${root}player/components/legacy-view.js`);
    const { buildPvoManifest } = await import("/src/domain/export/manifest.ts");
    const { returnToVisualEditing } = await import("/src/domain/components/codeOwnership.ts");
    const state = window.sizeCapture.getState();
    state.updateComponent(state.components[0].id, returnToVisualEditing(state.components[0]));
    const current = window.sizeCapture.getState();
    const scene = current.scenes[0];
    const manifest = buildPvoManifest(current, [{ scene, assetId: "video", name: "video.mp4", type: "video/mp4" }]);
    registerComponentView();
    const frame = document.createElement("div");
    frame.style.cssText = "position:fixed;width:247px;height:440px";
    const overlay = document.createElement("div");
    frame.append(overlay);
    document.body.append(frame);
    const renderer = createOverlayRenderer({
      session: { captureMode: true, manifest, mountedCustom: new Map(), pvoLanguageSources: new Map(),
        capturedResponses: new Map(), pendingComponents: new Set() },
      refs: { frame, overlay, video: document.createElement("video") },
      adapters: { activeClip: () => ({ scene: "main" }), visibleComponents: () => manifest.components, elapsedTime: () => 4 },
    });
    try {
      renderer.renderOverlays(true);
      overlay.firstElementChild.style.width = "max-content";
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bounds = overlay.firstElementChild.getBoundingClientRect();
      return { width: bounds.width / 247 * 1080, height: bounds.height / 247 * 1080, view: !!overlay.querySelector("pvo-component-view") };
    } finally {
      renderer.destroyCustomOverlays();
      frame.remove();
    }
  }, root);
  assert(Math.abs(playerSize.width - 420) < .05);
  assert(Math.abs(playerSize.height - 360) < .05);
  assert.equal(playerSize.view, true);
  assert.deepEqual(errors, []);
  console.log("PASS: code-owned geometry stays editable and exported player uses the same independent dimensions.");
} finally {
  await browser.close();
}
