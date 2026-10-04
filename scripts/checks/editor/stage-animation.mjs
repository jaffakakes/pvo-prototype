import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const snapshot = () => page.evaluate(() => {
  const state = window.stageCheck.useCapture.getState();
  return { texts: state.texts, past: state.past.length, t: state.t, sheet: state.sheet,
    selectedKey: window.stageCheck.selection.getState().selection };
});
const positionAt = time => page.evaluate(time => {
  const { useCapture, authoring } = window.stageCheck;
  const state = useCapture.getState();
  return authoring.readAuthoringValue(state.scenes.find(scene => scene.id === state.currentSceneId),
    { kind: "text", id: 10 }, "position", time);
}, time);
const moveTitle = async (dx, dy, cancel = false, xFraction = .5) => {
  await page.locator('.textOverlay').click({ trial: true });
  const box = await page.locator('.textOverlay').boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width * xFraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * xFraction + dx, box.y + box.height / 2 + dy, { steps: 5 });
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
    const authoring = await import("/src/domain/animation/authoring.ts");
    const { useAnimationSelection: selection } = await import("/src/state/animation/selection.ts");
    const preview = await import("/src/features/preview/tryMode.ts");
    useCapture.getState().patch({ screen: "editor", clips: [mkClip(4, null, 0)],
      texts: [{ id: 10, text: "Move me", color: 0, start: 0, end: 4, x: 50, y: 40 }],
      layers: ["video", "text:10"], selText: 10, sel: -1, selComp: null, t: 2,
      playing: false, sheet: null, past: [], future: [] });
    window.stageCheck = { useCapture, commands, authoring, selection, preview };
  });
  await page.locator(".textOverlay").waitFor();
  await moveTitle(1, 1);
  let result = await snapshot();
  assert.equal(result.past, 0, "A click must not create an Undo step");
  assert.deepEqual([result.texts[0].x, result.texts[0].y], [50, 40]);
  assert.equal(result.texts[0].animation, undefined, "A click must not create a keyframe");
  await moveTitle(30, -20);
  result = await snapshot();
  assert.equal(result.past, 1);
  assert(result.texts[0].x > 50 && result.texts[0].y < 40,
    "A normal desktop drag changes the layer's base position");
  assert.equal(result.texts[0].animation, undefined,
    "A normal desktop drag must not create animation");
  const firstBase = { x: result.texts[0].x, y: result.texts[0].y };
  assert.deepEqual(await positionAt(.5), firstBase, "Base placement applies near the layer start");
  assert.deepEqual(await positionAt(3.5), firstBase, "Base placement applies near the layer end");
  await page.evaluate(() => window.stageCheck.useCapture.getState().undo());
  assert.deepEqual((await snapshot()).texts[0].x, 50, "One Undo restores base placement");
  await page.evaluate(() => window.stageCheck.useCapture.getState().redo());
  assert.deepEqual((await snapshot()).texts[0].x, firstBase.x, "One Redo restores base placement");
  await moveTitle(-15, 10);
  result = await snapshot();
  assert.equal(result.past, 2, "A second placement drag commits one Undo step");
  assert.equal(result.texts[0].animation, undefined);
  const beforeCancel = result.texts;
  await moveTitle(30, 30, true);
  assert.deepEqual((await snapshot()).texts, beforeCancel);
  assert.equal((await snapshot()).past, 2);

  await page.getByRole("tab", { name: "Style", exact: true }).click();
  const inspector = page.locator("[data-keyframe-editor]").filter({ visible: true });
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ t: 0 }));
  await inspector.getByRole("button", { name: "Add Position keyframe", exact: true }).click();
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ t: 2 }));
  await inspector.getByRole("button", { name: "Add Position keyframe", exact: true }).click();
  const beforeKeyDrag = await snapshot();
  assert.equal(beforeKeyDrag.selectedKey.group, "position",
    "Adding the Position key explicitly selects it for dragging");
  const baseBeforeKeyDrag = { x: beforeKeyDrag.texts[0].x, y: beforeKeyDrag.texts[0].y };
  const tracksBeforeKeyDrag = structuredClone(beforeKeyDrag.texts[0].animation.tracks);
  await moveTitle(30, -20);
  result = await snapshot();
  assert.equal(result.past, beforeKeyDrag.past + 1, "Dragging the selected Position key commits one Undo step");
  assert.deepEqual({ x: result.texts[0].x, y: result.texts[0].y }, baseBeforeKeyDrag,
    "Dragging a selected Position key retains base placement");
  assert.notDeepEqual(result.texts[0].animation.tracks, tracksBeforeKeyDrag,
    "Dragging a selected Position key edits its curve");
  assert.deepEqual(await positionAt(0), baseBeforeKeyDrag,
    "The earlier key retains the original position");
  assert.notDeepEqual(await positionAt(2), baseBeforeKeyDrag,
    "The selected key moves the layer at its time");
  const keyBeforeOffCenterDrag = await positionAt(2);
  const canvas = await page.locator(".pvBox").boundingBox();
  assert(canvas);
  await moveTitle(-15, 10, false, .25);
  result = await snapshot();
  assert.equal(result.past, beforeKeyDrag.past + 2,
    "A current-key handle must not steal the next selected-key drag");
  const keyAfterOffCenterDrag = await positionAt(2);
  assert(Math.abs((keyAfterOffCenterDrag.x - keyBeforeOffCenterDrag.x) / 100 * canvas.width + 15) < 3,
    "An off-centre selected-key drag must move only by the pointer's horizontal distance");
  assert(Math.abs((keyAfterOffCenterDrag.y - keyBeforeOffCenterDrag.y) / 100 * canvas.height - 10) < 3,
    "An off-centre selected-key drag must move only by the pointer's vertical distance");
  const beforeKeyCancel = structuredClone(result.texts);
  await moveTitle(30, 30, true);
  assert.deepEqual((await snapshot()).texts, beforeKeyCancel,
    "Cancelling a selected-key drag restores its curve");

  const baseBeforeScaleDrag = { x: result.texts[0].x, y: result.texts[0].y };
  const positionsBeforeScaleDrag = [await positionAt(0), await positionAt(2)];
  await page.evaluate(() => window.stageCheck.useCapture.getState().patch({ t: 1 }));
  await inspector.getByRole("button", { name: "Add Scale keyframe", exact: true }).click();
  const scaleSelected = await snapshot();
  assert.equal(scaleSelected.selectedKey.group, "scale");
  const curvesBeforeBaseShift = structuredClone(scaleSelected.texts[0].animation.tracks);
  await moveTitle(16, 12);
  result = await snapshot();
  assert.deepEqual(result.texts[0].animation.tracks, curvesBeforeBaseShift,
    "A selected Scale key cannot turn a Position drag into keyframe editing");
  assert(result.texts[0].x > baseBeforeScaleDrag.x && result.texts[0].y > baseBeforeScaleDrag.y,
    "A Position drag with a selected Scale key moves base placement");
  const baseShift = { x: result.texts[0].x - baseBeforeScaleDrag.x,
    y: result.texts[0].y - baseBeforeScaleDrag.y };
  const positionsAfterBaseShift = [await positionAt(0), await positionAt(2)];
  for (let index = 0; index < 2; index++) {
    assert(Math.abs(positionsAfterBaseShift[index].x - positionsBeforeScaleDrag[index].x - baseShift.x) < .001);
    assert(Math.abs(positionsAfterBaseShift[index].y - positionsBeforeScaleDrag[index].y - baseShift.y) < .001);
  }

  await page.evaluate(() => window.stageCheck.selection.getState().clear());
  const unselected = await snapshot();
  const unselectedCurves = structuredClone(unselected.texts[0].animation.tracks);
  const unselectedPositions = [await positionAt(0), await positionAt(2)];
  await moveTitle(-12, -8);
  result = await snapshot();
  assert.deepEqual(result.texts[0].animation.tracks, unselectedCurves,
    "An unselected animated layer drag must preserve every existing keyframe");
  const unselectedShift = { x: result.texts[0].x - unselected.texts[0].x,
    y: result.texts[0].y - unselected.texts[0].y };
  const unselectedPositionsAfter = [await positionAt(0), await positionAt(2)];
  for (let index = 0; index < 2; index++) {
    assert(Math.abs(unselectedPositionsAfter[index].x - unselectedPositions[index].x - unselectedShift.x) < .001);
    assert(Math.abs(unselectedPositionsAfter[index].y - unselectedPositions[index].y - unselectedShift.y) < .001);
  }

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
  await page.evaluate(() => {
    window.stageCheck.selection.getState().clear();
    window.stageCheck.useCapture.getState().patch({ sheet: "animation", t: 1.5 });
  });
  const beforeMobileBaseDrag = await snapshot();
  await moveTitle(20, 15);
  result = await snapshot();
  assert.equal(result.sheet, "animation");
  assert(result.texts[0].x > beforeMobileBaseDrag.texts[0].x
    && result.texts[0].y > beforeMobileBaseDrag.texts[0].y,
  "Opening Animate alone must still drag the base placement");
  assert.deepEqual(result.texts[0].animation, beforeMobileBaseDrag.texts[0].animation,
    "Opening Animate alone must not add a keyframe");
  await page.locator("[data-animation-sheet]").getByRole("button", { name: "Keyframe", exact: true }).click();
  const selectedMobileKey = await snapshot();
  assert.equal(selectedMobileKey.selectedKey.group, "position",
    "The mobile Keyframe button explicitly selects a Position key");
  const mobileBase = { x: selectedMobileKey.texts[0].x, y: selectedMobileKey.texts[0].y };
  await moveTitle(20, 15);
  result = await snapshot();
  assert.deepEqual({ x: result.texts[0].x, y: result.texts[0].y }, mobileBase,
    "Dragging a selected mobile key does not move base placement");
  assert.equal(result.past, selectedMobileKey.past + 1,
    "Dragging the selected mobile key commits one Undo step");
  assert.notDeepEqual(result.texts[0].animation, selectedMobileKey.texts[0].animation,
    "Dragging the selected mobile key edits its animation");
  for (const property of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"])
    assert(result.texts[0].animation.tracks[property]?.some(frame => frame.time === 1.5),
      `Mobile Keyframe saves ${property}: ${JSON.stringify(result)}`);

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
  console.log("Stage animation passed: static base dragging, explicit Position key selection, preserved animated curves, mobile Animate placement, cancellation, path seek, authoring endpoints and exclusive playback/Try bounds.");
} finally { await browser.close(); }
