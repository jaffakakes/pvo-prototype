import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const snapshot = () => page.evaluate(() => {
  const state = window.stageCheck.useCapture.getState();
  return { texts: state.texts, past: state.past.length, t: state.t, sheet: state.sheet };
});
const moveTitle = async (dx, dy, cancel = false) => {
  await page.locator('.textOverlay').click({ trial: true });
  const box = await page.locator('.textOverlay').boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
};
try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Blank project", exact: true }).click();
  await page.locator("[data-desktop-player]").waitFor();
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const commands = await import("/src/state/animation/commands.ts");
    const preview = await import("/src/features/preview/tryMode.ts");
    useCapture.getState().patch({ screen: "editor", clips: [mkClip(4, null, 0)],
      texts: [{ id: 10, text: "Move me", color: 0, start: 0, end: 4, x: 50, y: 40 }],
      layers: ["video", "text:10"], selText: 10, sel: -1, selComp: null, t: 2,
      playing: false, sheet: null, past: [], future: [] });
    window.stageCheck = { useCapture, commands, preview };
  });
  await page.locator(".textOverlay").waitFor();
  await moveTitle(1, 1);
  assert.equal((await snapshot()).past, 0, "A click must not create a key or Undo step");
  await moveTitle(30, -20);
  let result = await snapshot();
  assert.equal(result.past, 1);
  assert.deepEqual(Object.keys(result.texts[0].animation.tracks).sort(), ["x", "y"]);
  assert.deepEqual([result.texts[0].x, result.texts[0].y], [50, 40]);
  await moveTitle(-15, 10);
  result = await snapshot();
  assert.equal(result.past, 2, "A current-key handle must not steal the second title drag");
  const beforeCancel = result.texts;
  await moveTitle(30, 30, true);
  assert.deepEqual((await snapshot()).texts, beforeCancel);
  assert.equal((await snapshot()).past, 2);
  await page.evaluate(() => {
    const { commands, useCapture } = window.stageCheck;
    commands.setAuthoringValue({ kind: "text", id: 10 }, "position", 0, { x: 20, y: 20 });
    useCapture.getState().patch({ t: 2 });
  });
  const beforeSeek = (await snapshot()).past;
  await page.locator('[data-animation-path-key][aria-label="Position keyframe at 0 seconds"]').click();
  assert.equal((await snapshot()).t, 0);
  assert.equal((await snapshot()).past, beforeSeek);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ sheet: "animation", t: 1 }));
  await moveTitle(20, 15);
  result = await snapshot();
  assert.equal(result.sheet, "animation");
  for (const property of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"])
    assert(result.texts[0].animation.tracks[property]?.some(frame => frame.time === 1), `Mobile drag saves ${property}: ${JSON.stringify(result)}`);

  // End keys remain authorable without extending the layer's viewing interval.
  await page.evaluate(() => {
    const { useCapture, commands } = window.stageCheck;
    const state = useCapture.getState();
    state.patch({ texts: state.texts.map(text => ({ ...text, end: 3 })), t: 3 });
    commands.setAuthoringValue({ kind: "text", id: 10 }, "position", 3, { x: 65, y: 45 }, { wholeTransform: true });
  });
  await page.locator('.textOverlay').waitFor();
  assert.equal(await page.locator('.textLayer[data-layer-id="text:10"]').count(), 1, "Animate displays the selected text's final keyframe");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ sheet: null }));
  await page.locator('.textOverlay').waitFor();
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ selText: null }));
  await page.locator('.textLayer[data-layer-id="text:10"]').waitFor({ state: "detached" });
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ selText: 10, playing: true }));
  assert.equal(await page.locator('.textLayer[data-layer-id="text:10"]').count(), 0, "Playback does not extend a selected text past its end");
  await page.evaluate(() => {
    const { useCapture, preview } = window.stageCheck;
    useCapture.getState().patch({ t: 2.5, playing: false });
    preview.startTry();
    useCapture.getState().patch({ t: 3, playing: false });
  });
  assert.equal(await page.locator('.textLayer[data-layer-id="text:10"]').count(), 0, "Try keeps the text interval end-exclusive");
  await page.evaluate(() => window.stageCheck.preview.stopTry());
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => {
    const { useCapture } = window.stageCheck;
    const id = useCapture.getState().addComponent("tooltip");
    const state = useCapture.getState();
    state.patch({ components: state.components.map(component => ({ ...component, at: 0, dur: 3 })),
      t: 3, playing: false, sheet: "animation", selComp: id, selText: null });
  });
  await page.locator('[data-preview-component]').waitFor();
  assert.equal(await page.locator('[data-preview-component]').count(), 1, "Animate displays the selected component's final keyframe");
  await page.evaluate(() => {
    const { useCapture, preview } = window.stageCheck;
    useCapture.getState().patch({ t: 2.5 });
    preview.startTry();
    useCapture.getState().patch({ t: 3, playing: false });
  });
  await page.locator('[data-preview-component]').waitFor({ state: "detached" });
  await page.evaluate(() => window.stageCheck.preview.stopTry());
  assert.deepEqual(errors, []);
  console.log("Stage animation passed: desktop auto-key, click threshold, current-key drag, cancellation, path seek, whole-transform mobile drag, authoring endpoints and exclusive playback/Try bounds.");
} finally { await browser.close(); }
