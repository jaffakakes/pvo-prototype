import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";

const browser = await launchBrowser();
const errors = [];
async function settle(page) {
  await page.waitForFunction(() => !document.documentElement.dataset.editorMotion);
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { y: rect.y, height: rect.height, bottom: rect.bottom };
    };
    return { dock: box(".editorDock"), preview: box(".previewArea"), header: box(".editorHead") };
  });
}
try {
  for (const [width, height] of [[320, 693], [390, 844], [430, 932]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const { useCapture, mkClip } = await import("/src/store.ts");
        const { initial } = await import("/src/state/project/initial.ts");
        useCapture.setState(initial());
        useCapture.getState().patch({ screen: "editor", clips: [mkClip(20, null, 0)], t: 2, sel: -1, sheet: "components" });
        window.workspaceCheck = useCapture;
      });
      await page.getByRole("button", { name: "Close sheet", exact: true }).waitFor();
      await settle(page);
      assert((await geometry(page)).dock.height >= 150, "Direct sheet entry waits for measurements");
      await page.getByRole("button", { name: "Close sheet", exact: true }).click();
      await settle(page);
      const headerButtons = await page.locator(".editorHead button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => ({ x: rect.x, right: rect.right, width: rect.width, height: rect.height })));
      assert(headerButtons.every(button => button.x >= 0 && button.right <= width && button.width >= 44 && button.height >= 44));
      await page.evaluate(async () => {
        const state = window.workspaceCheck.getState();
        state.addComponent("choice");
        state.patch({ sheet: null });
      });
      await page.getByRole("toolbar", { name: "Choice tools" }).getByRole("button", { name: "Opacity", exact: true }).click();
      await page.getByRole("slider", { name: "Opacity", exact: true }).waitFor();
      await settle(page);
      const expanded = await geometry(page);
      assert(expanded.preview.bottom <= expanded.dock.y + 1);
      assert.equal(await page.getByRole("separator", { name: /^Resize (timeline|editing panel)$/ }).count(), 0);
      await page.locator("[data-sheet-body]").evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert(Math.abs((await geometry(page)).dock.height - expanded.dock.height) < 2, "Content scrolling preserves panel size");
      await page.getByRole("button", { name: "Close sheet", exact: true }).focus();
      await page.keyboard.press("t");
      await page.getByRole("button", { name: "Stop trying", exact: true }).waitFor();
      await settle(page);
      assert.equal((await geometry(page)).dock.height, 0);
      await page.evaluate(async () => {
        const state = window.workspaceCheck.getState();
        const base = state.scenes.find(scene => scene.id === "main");
        state.patch({ scenes: [...state.scenes, { ...base, id: "branch", parent: "main", name: "Branch" }] });
        const { runComponentResponse } = await import("/src/features/preview/tryMode.ts");
        await runComponentResponse(state.components[0], { index: 0, outcome: { kind: "scene", sceneId: "branch" } });
      });
      assert.equal(await page.evaluate(() => window.workspaceCheck.getState().currentSceneId), "branch");
      await page.getByRole("button", { name: "Stop trying", exact: true }).click();
      await page.getByRole("slider", { name: "Opacity", exact: true }).waitFor();
      await settle(page);
      assert.equal(await page.evaluate(() => window.workspaceCheck.getState().sheet), "componentOpacity");
      assert(Math.abs((await geometry(page)).dock.height - expanded.dock.height) < 2, "Routed Try restores the same editing panel");
      await page.getByRole("button", { name: "Close sheet", exact: true }).click();
      await settle(page);
      await page.evaluate(() => { const state = window.workspaceCheck.getState(); state.addText("Keyboard fixture"); state.patch({ sheet: null }); });
      await page.getByRole("button", { name: "Edit text", exact: true }).click();
      const field = page.getByRole("textbox", { name: "Text content", exact: true });
      await field.waitFor();
      await field.focus();
      await settle(page);
      const beforeKeyboard = await geometry(page);
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, "height", { configurable: true, value: window.innerHeight - 200 });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.locator('.editorWorkspace[data-keyboard-open="true"]').waitFor();
      await settle(page);
      const fieldBox = await field.boundingBox();
      assert(fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= height - 200, `${width}: focused text stays above the simulated keyboard`);
      await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event("resize")); });
      await page.locator('.editorWorkspace[data-keyboard-open="false"]').waitFor();
      await settle(page);
      assert(Math.abs((await geometry(page)).dock.height - beforeKeyboard.dock.height) < 2, "Keyboard dismissal restores panel height");
      await page.getByRole("button", { name: "Hide keyboard", exact: true }).click();
      await page.getByRole("button", { name: "Close sheet", exact: true }).focus();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Edit text", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.workspaceCheck.getState().sheet), null);
      console.log(`Current no-code workspace passed at ${width} × ${height}: panels, routed Try, simulated keyboard and Escape.`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
