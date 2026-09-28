import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/?home=1");
  await page.getByRole("button", { name: "Try a sample clip", exact: true }).click();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await page.locator("[data-desktop-editor]").waitFor();
  await page.setViewportSize({ width: 390, height: 850 });
  await page.locator(".tl").waitFor();
  await page.evaluate(async () => {
    const storeUrl = performance.getEntriesByType("resource").map(entry => entry.name)
      .find(url => new URL(url).pathname === "/src/state/captureStore.ts");
    const { useCapture } = await import(storeUrl);
    const state = useCapture.getState();
    state.addText("Selection test");
    state.addComponent("card");
    state.patch({ sheet: null, sel: -1, selText: null, selComp: null });
  });
  const tools = page.locator(".tools");
  const main = () => tools.getByRole("button", { name: "Edit clip", exact: true }).waitFor();
  const layer = kind => page.locator(`[data-reorder-layer${kind === "video" ? "=" : "^="}'${kind}']`).first();
  const blankPreview = async () => {
    const box = await page.locator(".pvBox").boundingBox();
    await page.touchscreen.tap(box.x + 5, box.y + 5);
  };
  for (const kind of ["video", "text:", "component:"]) {
    await layer(kind).tap();
    await tools.getByRole("button", { name: /^Collapse/ }).waitFor();
    await blankPreview();
    await main();
    for (const selector of [".editorHead h1", ".transportTime", ".previewArea", ".toolBar"]) {
      await layer(kind).tap();
      const bounds = await page.locator(selector).boundingBox();
      await page.touchscreen.tap(bounds.x + 4, bounds.y + 4);
      await main();
    }
    await layer(kind).tap();
    const timeline = await page.locator(".tl").boundingBox();
    await page.touchscreen.tap(timeline.x + 250, timeline.y + 12);
    await main();
  }
  await layer("text:").tap();
  await layer("component:").tap();
  await tools.getByRole("button", { name: "Collapse component tools" }).tap();
  await main();
  await layer("text:").tap();
  await layer("video").tap();
  await tools.getByRole("button", { name: "Split", exact: true }).waitFor();
  await tools.getByRole("button", { name: "Speed", exact: true }).tap();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "2x", exact: true }).tap();
  assert(await page.getByRole("dialog").isVisible(), "Panel controls remain usable");
  await blankPreview();
  await main();
  assert.equal(await page.getByRole("dialog").count(), 0, "Outside taps close the editing panel");
  await layer("video").tap();
  await tools.getByRole("button", { name: "Speed", exact: true }).tap();
  await page.getByRole("heading", { name: "Speed", exact: true }).tap();
  await main();
  for (const kind of ["text:", "component:"]) {
    await layer(kind).tap();
    await tools.getByRole("button", { name: kind === "text:" ? "Edit text" : "Edit", exact: true }).tap();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    await blankPreview();
    await main();
  }
  await layer("text:").tap();
  const box = await page.locator(".pvBox").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 5, y: box.y + 5 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 12, y: box.y + 5 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await main();
  await layer("video").tap();
  await tools.getByRole("button", { name: "Extract audio", exact: true }).tap();
  await tools.getByRole("button", { name: "Mute", exact: true }).waitFor();
  await blankPreview();
  await main();
  console.log("Selection dismissal passed: all layer types, open Speed/Text/Component panels, panel controls, and touch jitter.");
} finally {
  await browser.close();
}
