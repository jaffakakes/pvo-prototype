import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];

async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    return { dock: box(".editorDock"), preview: box(".previewArea"), header: box(".editorHead"), playback: box(".transport") };
  });
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await page.waitForTimeout(80);
}

try {
  for (const [width, height, minimumPlayer] of [[320, 693, 150], [390, 844, 190], [430, 932, 190]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const { useCapture, mkClip } = await import("/src/store.ts");
      const clip = mkClip(20, null, 0);
      useCapture.setState({
        scenes: [{ id: "main", name: "Main", clips: [clip], texts: [], components: [], muted: false, sound: 0, layers: ["video"] }],
        currentSceneId: "main", clips: [clip], texts: [], components: [], layers: ["video"],
        screen: "editor", t: 2, sel: -1, selComp: null, selText: null, sheet: "components",
        playing: false, tryMode: null, past: [], future: [],
      });
    });
    await page.locator(".editorWorkspace").waitFor();
    await settle(page);
    assert((await geometry(page)).dock.height >= 150, `${width}: opening directly into a sheet waits for workspace measurements`);
    await page.getByRole("dialog", { name: "Add a component", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    await settle(page);
    const original = await geometry(page);
    const headerButtons = await page.locator(".editorHead button").evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x, right: rect.right, width: rect.width, height: rect.height };
    }));
    assert(headerButtons.every(button => button.x >= 0 && button.right <= width && button.width >= 44 && button.height >= 44), `${width}: header controls fit with 44px hit areas: ${JSON.stringify(headerButtons)}`);
    await page.getByRole("button", { name: "Components", exact: true }).click();
    await settle(page);
    const opened = await geometry(page);
    assert(Math.abs(opened.dock.height - original.dock.height) < 2, `${width}: opening swaps the same lower-region height`);
    assert(Math.abs(opened.preview.height - original.preview.height) < 2, `${width}: opening keeps the player still`);
    await page.evaluate(async () => {
      const { useCapture } = await import("/src/store.ts");
      useCapture.getState().addComponent("choice");
    });
    await settle(page);
    const handle = page.getByRole("separator", { name: "Resize editing panel", exact: true });
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, 0, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    const expanded = await geometry(page);
    assert(expanded.preview.height >= minimumPlayer - 2, `${width}: the video remains visible at maximum sheet height`);
    assert.equal(expanded.header.height, 56);
    assert.equal(expanded.playback.height, 52);
    assert(expanded.preview.bottom <= expanded.dock.y, `${width}: sheets stay below the video`);
    await page.locator("[data-sheet-body]").evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert(Math.abs((await geometry(page)).dock.height - expanded.dock.height) < 2, "Scrolling does not resize the sheet");
    await page.getByRole("tab", { name: "Action", exact: true }).click();
    await page.getByRole("button", { name: "Try", exact: true }).click();
    await settle(page);
    assert.equal((await geometry(page)).dock.height, 0, "Try hides the whole lower region");
    await page.evaluate(async () => {
      const { useCapture } = await import("/src/store.ts");
      const state = useCapture.getState();
      state.patch({ scenes: [...state.scenes, { id: "branch", parent: "main", name: "Branch", clips: state.clips,
        texts: [], components: [], layers: ["video"], muted: false, sound: 0 }] });
      const { runComponentResponse } = await import("/src/features/preview/tryMode.ts");
      await runComponentResponse(state.components[0], { index: 0, outcome: { kind: "scene", sceneId: "branch" } });
    });
    await page.getByRole("heading", { name: "Trying", exact: true }).waitFor();
    await page.getByText("Tap like a viewer · Branch", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settle(page);
    assert(Math.abs((await geometry(page)).dock.height - expanded.dock.height) < 2, "Stop restores the sheet height after routing to another scene");
    assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().sheet), "component");
    assert.equal(await page.getByRole("tab", { name: "Action", exact: true }).getAttribute("aria-selected"), "true", "Routed Try restores the same component tab");
    await page.getByRole("tab", { name: "Content", exact: true }).click();
    await handle.focus();
    await page.keyboard.press("t");
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    await settle(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Try", exact: true }).waitFor();
    await settle(page);
    const beforeKeyboard = await geometry(page);
    const field = page.locator('[data-sheet-body] input[type="text"], [data-sheet-body] input:not([type])').first();
    await field.focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: window.innerHeight - 200 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.locator('.editorWorkspace[data-keyboard-open="true"]').waitFor();
    await settle(page);
    const fieldBox = await field.boundingBox();
    assert(fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= height - 200, `${width}: focused field stays above the keyboard`);
    assert.equal(await page.locator('[data-component-tabs]:visible').count(), 0, "The tabs hide while the OS keyboard is open");
    await field.evaluate(element => element.blur());
    await page.evaluate(() => {
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.locator('.editorWorkspace[data-keyboard-open="false"]').waitFor();
    await settle(page);
    await page.waitForFunction(expected => Math.abs(document.querySelector(".editorDock").getBoundingClientRect().height - expected) < 2, beforeKeyboard.dock.height);
    const afterKeyboard = await geometry(page);
    assert(Math.abs(afterKeyboard.dock.height - beforeKeyboard.dock.height) < 2, `Keyboard dismissal restores the original sheet height: ${JSON.stringify({ beforeKeyboard, afterKeyboard })}`);
    const closeBox = await handle.boundingBox();
    await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(closeBox.x + closeBox.width / 2, height - 60, { steps: 10 });
    await page.mouse.up();
    await page.locator(".toolBar").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().sheet), null, "Pulling down below 120 closes the sheet");
    await context.close();
    console.log(`No-code workspace passed at ${width} × ${height}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
