import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const compilerPath = fileURLToPath(new URL("../../../packages/pvo-language/index.js", import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

// Model a browser that does not deliver preview measurements while the launch
// surface covers an inert editor. The element's size need not change on reveal,
// so no later native notification is guaranteed to repair a missed first one.
await context.addInitScript(() => {
  if (!new URL(location.href).searchParams.has("stalled-preview")) return;
  Object.defineProperty(document.fonts, "ready", { get: () => new Promise(() => {}) });
  const NativeObserver = ResizeObserver;
  const hiddenDuringLaunch = new URL(location.href).searchParams.has("hidden-preview");
  if (hiddenDuringLaunch) document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "#root[inert] .previewArea { display: none !important; }";
    document.head.append(style);
  }, { once: true });
  window.__previewSuppressed = 0;
  window.__previewObservers = 0;
  window.__previewIgnoreNotifications = hiddenDuringLaunch;
  window.ResizeObserver = class {
    targets = new Set();
    constructor(callback) {
      this.native = new NativeObserver(entries => {
        const visible = entries.filter(entry => {
          if (entry.target.matches(".previewArea") && (document.querySelector("#root")?.hasAttribute("inert") || window.__previewIgnoreNotifications)) {
            window.__previewSuppressed++;
            return false;
          }
          return true;
        });
        if (visible.length) callback(visible, this);
      });
    }
    observe(target, options) {
      if (target.matches(".previewArea") && !this.targets.has(target)) window.__previewObservers++;
      this.targets.add(target);
      this.native.observe(target, options);
    }
    unobserve(target) {
      if (target.matches(".previewArea") && this.targets.delete(target)) window.__previewObservers--;
      this.native.unobserve(target);
    }
    disconnect() {
      for (const target of this.targets) if (target.matches(".previewArea")) window.__previewObservers--;
      this.targets.clear();
      this.native.disconnect();
    }
  };
});

const snapshot = () => page.evaluate(async () => {
  const { useCapture } = await import("/src/store.ts");
  const { projectSnapshot } = await import("/src/state/project/history.ts");
  return JSON.parse(JSON.stringify(projectSnapshot(useCapture.getState())));
});
async function measure() {
  return page.evaluate(() => {
    const area = document.querySelector(".previewArea"), canvas = document.querySelector(".pvBox");
    const bounds = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { area: bounds(area), canvas: bounds(canvas), inline: { width: canvas.style.width, height: canvas.style.height },
      suppressed: window.__previewSuppressed, observers: window.__previewObservers,
      clip: bounds(document.querySelector(".pvFallback")), form: bounds(document.querySelector("[data-preview-component]")) };
  });
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#root")?.firstElementChild && !document.querySelector("#root")?.hasAttribute("aria-busy"));
  await page.evaluate(async compilerPath => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { navigateProject } = await import("/src/app/navigation.ts");
    const { prepareNativeBatch } = await import("/src/domain/assistant/native/batch.ts");
    const { projectSnapshot } = await import("/src/state/project/history.ts");
    const { applyAssistantChanges } = await import("/src/state/assistant/applyChanges.ts");
    const { createProjectPersistence } = await import("/src/infrastructure/projectPersistence/index.ts");
    const source = {
      structure: '<form><heading>Your phone number</heading><field name="phone" kind="phone" label="Phone number"/><submit>Continue</submit></form>',
      style: 'form { background: #f5f4ef; color: #112233; border-radius: 20px; } heading { font-size: 20px; } field { font-size: 18px; } submit { background: #112233; color: #ffffff; }',
      logic: 'on submit { continue(); }',
    };
    // The editor compiler adapter is the same facade used by assistant preparation.
    const { compilePvoComponent } = await import(`/@fs${compilerPath}`);
    useCapture.setState(initial());
    useCapture.getState().patch({ localId: "preview-startup-fixture", screen: "editor", clips: [mkClip(8, null, 0)],
      ratio: "9:16", sound: -1, muted: true, t: 1, playing: false, sel: -1, past: [], future: [] });
    navigateProject("preview-startup-fixture", true);
    const before = projectSnapshot(useCapture.getState());
    const batch = await prepareNativeBatch(before, [{ kind: "component.add", sceneId: "main", componentType: "form", at: 0, duration: 8, source }],
      { createId: () => 99, compile: compilePvoComponent, advancedEditingEnabled: false });
    applyAssistantChanges(batch);
    useCapture.getState().updateComponent("component-99", { width: 720, height: 420, scale: 1, x: 65, y: 85 });
    const persistence = createProjectPersistence("preview-startup-fixture");
    persistence.schedule(useCapture.getState());
    await persistence.flush();
    await persistence.dispose();
  }, compilerPath);
  const original = await snapshot();
  for (const hiddenDuringLaunch of [false, true]) {
    await page.setViewportSize({ width: 1440, height: 960 });
    const restored = new URL(editorUrl);
    restored.search = `?project=preview-startup-fixture&stalled-preview=1${hiddenDuringLaunch ? "&hidden-preview=1" : ""}`;
    await page.goto(restored.href, { waitUntil: "domcontentloaded" });
    await page.locator("[data-desktop-editor]").waitFor({ state: "attached" });
    if (hiddenDuringLaunch) assert.equal(await page.locator(".previewArea").evaluate(element => element.clientWidth), 0);
    await page.waitForFunction(() => !document.querySelector("#restyle-launch-splash"), null, { polling: 100 });
    await page.locator('iframe[sandbox="allow-same-origin"]').waitFor({ state: "attached" });
    const afterLaunch = await measure();
    assert.ok(afterLaunch.suppressed > 0, "The fixture must withhold a preview notification during startup");
    assert.equal(afterLaunch.observers, 1, "Strict-mode remount must leave only one preview observer");
    assert.ok(afterLaunch.area.width > 200 && afterLaunch.area.height > 200, "The restored player has actual available space");
    assert.ok(afterLaunch.canvas.width > 150 && afterLaunch.canvas.height > 250,
      `A missed startup measurement must not collapse the video and form to a border dot: ${JSON.stringify(afterLaunch)}`);
    assert.ok(afterLaunch.clip.width > 150 && afterLaunch.form.width > 100);
    await page.frameLocator('iframe[sandbox="allow-same-origin"]').locator('input[type="tel"]').waitFor({ state: "visible" });
    if (!hiddenDuringLaunch) await page.screenshot({ path: "/tmp/restyle-preview-startup-visible.png" });
    assert.deepEqual(await snapshot(), original, "Revealing the preview preserves the restored clip and generated component");

    // Recover from later lifecycle events too, without requiring an observer event.
    await page.evaluate(() => { window.__previewIgnoreNotifications = true; });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(previous => {
      const area = document.querySelector(".previewArea"), canvas = document.querySelector(".pvBox");
      const bounds = canvas.getBoundingClientRect();
      return bounds.width > 150 && bounds.width < area.getBoundingClientRect().width
        && (bounds.width !== previous.width || bounds.height !== previous.height);
    }, afterLaunch.canvas, { polling: 100 });
    assert.deepEqual(await snapshot(), original);
    await page.evaluate(async () => {
      const { navigateProject } = await import("/src/app/navigation.ts");
      navigateProject(null, true);
    });
    await page.locator("#create-title").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__previewObservers), 0, "Leaving the editor disconnects preview measurements");
  }
  assert.deepEqual(errors, []);
  console.log("Preview startup passed: restored pink clip/custom telephone form remain visible after stalled reveal, missed initial measurements and viewport resize without project edits.");
} catch (error) {
  console.error(await measure().catch(() => null));
  await page.screenshot({ path: "/tmp/restyle-preview-startup-failure.png" });
  throw error;
} finally {
  await browser.close();
}
