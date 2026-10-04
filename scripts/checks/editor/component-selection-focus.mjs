import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));

const dimmer = page.locator("[data-component-focus-dimmer]");
const focused = page.locator('.compOverlay[data-component-focused="true"]');
const selected = page.locator('.compOverlay[data-sel="true"]');

function assertNear(actual, expected, message, tolerance = 3) {
  assert(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`);
}

async function selectedGeometry() {
  return selected.evaluate(element => {
    const canvas = element.closest(".pvBox");
    const preview = canvas.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const origin = {
      x: preview.left + Number.parseFloat(style.borderLeftWidth),
      y: preview.top + Number.parseFloat(style.borderTopWidth),
    };
    return {
      center: { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 },
      previewCenter: { x: origin.x + canvas.clientWidth / 2, y: origin.y + canvas.clientHeight / 2 },
      authoredCenter: {
        x: origin.x + canvas.clientWidth * Number.parseFloat(element.style.left) / 100,
        y: origin.y + canvas.clientHeight * Number.parseFloat(element.style.top) / 100,
      },
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  });
}

async function restartFocus() {
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await focused.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
}

async function seekFocusEntrance(progress, finish = true) {
  return focused.evaluate((element, { progress, finish: shouldFinish }) => {
    const animation = element.getAnimations().find(item => item.animationName?.includes("componentFocusEnter"));
    const dimmer = element.closest(".pvBox").querySelector("[data-component-focus-dimmer]");
    const dimAnimation = dimmer?.getAnimations().find(item => item.animationName?.includes("componentDimIn"));
    if (!animation || !dimAnimation) return {
      animation: !!animation, dimmerAnimation: !!dimAnimation,
      componentName: getComputedStyle(element).animationName,
      dimmerName: dimmer ? getComputedStyle(dimmer).animationName : null,
      componentAnimations: element.getAnimations().map(item => item.animationName),
      dimmerAnimations: dimmer?.getAnimations().map(item => item.animationName),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    const duration = Number(animation.effect.getTiming().duration);
    const dimDuration = Number(dimAnimation.effect.getTiming().duration);
    const center = () => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    };
    animation.pause();
    dimAnimation.pause();
    animation.currentTime = 0;
    dimAnimation.currentTime = 0;
    const from = center();
    const dimFrom = Number.parseFloat(getComputedStyle(dimmer).opacity);
    animation.currentTime = duration * progress;
    dimAnimation.currentTime = dimDuration * progress;
    const middle = center();
    const dimMiddle = Number.parseFloat(getComputedStyle(dimmer).opacity);
    animation.currentTime = duration;
    dimAnimation.currentTime = dimDuration;
    const to = center();
    const dimTo = Number.parseFloat(getComputedStyle(dimmer).opacity);
    if (shouldFinish) {
      animation.finish();
      dimAnimation.finish();
    } else {
      animation.currentTime = duration * progress;
      dimAnimation.currentTime = dimDuration * progress;
    }
    return { animation: true, dimmerAnimation: true, duration, dimDuration,
      from, middle, to, dimFrom, dimMiddle, dimTo };
  }, { progress, finish });
}

async function focusState() {
  return page.locator(".pvBox").evaluate(canvas => {
    const dim = canvas.querySelector("[data-component-focus-dimmer]");
    const selected = canvas.querySelector('.compOverlay[data-sel="true"]');
    const other = canvas.querySelector('.compOverlay:not([data-sel="true"])');
    const video = canvas.querySelector(".videoLayer");
    const z = element => Number.parseInt(getComputedStyle(element).zIndex, 10);
    const bounds = element => element.getBoundingClientRect().toJSON();
    return {
      dim: dim ? { z: z(dim), bounds: bounds(dim), color: getComputedStyle(dim).backgroundColor } : null,
      selected: selected ? { z: z(selected), id: selected.dataset.previewComponent,
        focused: selected.dataset.componentFocused,
        outline: getComputedStyle(selected).outlineStyle,
        bounds: bounds(selected) } : null,
      other: other ? { z: z(other), id: other.dataset.previewComponent } : null,
      video: { z: z(video) },
      canvas: bounds(canvas),
      selectedPartOutlines: [...canvas.querySelectorAll('.compOverlay [data-part-selected="true"]')]
        .map(element => getComputedStyle(element).outlineStyle),
      formBorderWidth: getComputedStyle(selected?.querySelector(".compForm") ?? canvas.querySelector(".compForm")).borderTopWidth,
    };
  });
}

try {
  const response = await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await page.evaluate(async () => {
    const { useCapture, mkClip } = await import("/src/store.ts");
    const { setAdvancedEditingEnabled } = await import("/src/state/preferences/editorPreferences.ts");
    const { setComponentAuthoringTab } = await import("/src/state/components/componentAuthoringStore.ts");
    const clip = mkClip(20, null, 0);
    const scene = {
      id: "main", name: "Main", parent: null, clips: [clip], audioClips: [], texts: [], components: [],
      muted: true, sound: -1, layers: ["video"],
    };
    useCapture.setState({
      localId: crypto.randomUUID(), scenes: [scene], currentSceneId: "main",
      clips: [clip], audioClips: [], texts: [], components: [], layers: ["video"],
      muted: true, sound: -1, ratio: "9:16", screen: "editor", sheet: null,
      t: 4, sel: -1, selText: null, selComp: null, selAudio: null,
      playing: false, tryMode: null, playheadPick: null, past: [], future: [],
    });
    const state = useCapture.getState();
    const formId = state.addComponent("form");
    const otherId = useCapture.getState().addComponent("tooltip");
    const textId = useCapture.getState().addText("Caption");
    useCapture.getState().updateComponent(formId, { x: 32, y: 35 }, false);
    const form = useCapture.getState().components.find(item => item.id === formId);
    const originalPosition = { x: form.x, y: form.y };
    setAdvancedEditingEnabled(true);
    setComponentAuthoringTab(formId, "content");
    useCapture.getState().patch({ sel: -1, selComp: formId, selText: null, sheet: "component" });
    window.selectionFocusFixture = { store: useCapture, formId, otherId, textId, originalPosition };
  });
  await page.locator("[data-desktop-editor]").waitFor();
  await selected.waitFor();

  async function assertPlacementMode(label) {
    assert.equal(await focused.count(), 0, `${label} must not lift the selected component`);
    assert.equal(await dimmer.count(), 0, `${label} must not dim the preview`);
    const geometry = await selectedGeometry();
    assertNear(geometry.center.x, geometry.authoredCenter.x, `${label} must show the authored X`);
    assertNear(geometry.center.y, geometry.authoredCenter.y, `${label} must show the authored Y`);
    return geometry;
  }

  await assertPlacementMode("Ordinary component selection and Content");
  await page.getByRole("tab", { name: "Look", exact: true }).click();
  await assertPlacementMode("Look editing");
  const look = await focusState();
  assert.equal(look.selected.id, await page.evaluate(() => window.selectionFocusFixture.formId));
  assert.equal(look.selected.outline, "none", "Selection must not draw an outer component outline");
  assert(look.selectedPartOutlines.length > 0, "Look must expose its selected component part");
  assert(look.selectedPartOutlines.every(outline => outline === "none"),
    "Look selection must not draw an extra outline in the video");
  assert(Number.parseFloat(look.formBorderWidth) > 0,
    "The component's own visual border must remain intact");
  await page.getByRole("tab", { name: "Action", exact: true }).click();
  await assertPlacementMode("Action editing");
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  const beforePlacement = await assertPlacementMode("Content editing");

  const ordinaryFrame = await selected.boundingBox();
  assert(ordinaryFrame, "The Form must be visible at its authored position");
  const ordinaryStart = { x: ordinaryFrame.x + 18, y: ordinaryFrame.y + 18 };
  await page.mouse.move(ordinaryStart.x, ordinaryStart.y);
  await page.mouse.down();
  await page.mouse.move(ordinaryStart.x + 12, ordinaryStart.y + 9, { steps: 4 });
  await page.mouse.up();
  const afterPlacement = await assertPlacementMode("Direct placement drag");
  const placed = await page.evaluate(() => {
    const { store, formId, originalPosition } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { originalPosition, position: { x: component.x, y: component.y }, animation: component.animation };
  });
  assert.deepEqual(placed.originalPosition, { x: 32, y: 35 });
  assertNear((placed.position.x - placed.originalPosition.x) / 100 * beforePlacement.width, 12,
    "Direct drag must update the Form's base X by the pointer distance");
  assertNear((placed.position.y - placed.originalPosition.y) / 100 * beforePlacement.height, 9,
    "Direct drag must update the Form's base Y by the pointer distance");
  assert.equal(placed.animation, undefined,
    "Direct placement must not create a keyframe");
  assertNear(afterPlacement.center.x - beforePlacement.center.x, 12,
    "The Form must follow a horizontal placement drag");
  assertNear(afterPlacement.center.y - beforePlacement.center.y, 9,
    "The Form must follow a vertical placement drag");
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ t: 6 }));
  const earlyPosition = await selectedGeometry();
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ t: 12 }));
  const latePosition = await selectedGeometry();
  assertNear(latePosition.center.x, earlyPosition.center.x,
    "Base placement must stay at the same X throughout the component's visible interval");
  assertNear(latePosition.center.y, earlyPosition.center.y,
    "Base placement must stay at the same Y throughout the component's visible interval");
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ t: 4 }));

  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
  await dimmer.waitFor();
  const advanced = await focusState();
  assert.equal(advanced.selected.focused, "true", "Advanced code editing must focus the matching Form");
  assert(advanced.dim.z > advanced.video.z && advanced.dim.z > advanced.other.z,
    "The dimmer must cover video and unselected components during code editing");
  assert(advanced.selected.z > advanced.dim.z, "The edited component must sit above the dimmer");
  assert(advanced.dim.bounds.width >= advanced.canvas.width - 6 && advanced.dim.bounds.height >= advanced.canvas.height - 6,
    "The dimmer must cover the preview frame");
  assert(!/^(?:transparent|rgba\([^)]*,\s*0\))$/.test(advanced.dim.color),
    "The focus layer must visibly dim the background");
  await focused.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const centered = await selectedGeometry();
  assertNear(centered.center.x, centered.previewCenter.x, "Structure editing must center the Form horizontally");
  assertNear(centered.center.y, centered.previewCenter.y, "Structure editing must center the Form vertically");
  const afterFocusPosition = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { x: component.x, y: component.y };
  });
  assert.deepEqual(afterFocusPosition, placed.position,
    "Code preview focus must not change the authored position");
  if (process.env.COMPONENT_SELECTION_FOCUS_SCREENSHOT)
    await page.locator(".pvBox").screenshot({ path: process.env.COMPONENT_SELECTION_FOCUS_SCREENSHOT });

  for (const sourcePart of ["Style", "Logic", "Structure"]) {
    await page.getByRole("tab", { name: sourcePart, exact: true }).click();
    assert.equal(await focused.count(), 1, `${sourcePart} code editing must keep component focus`);
    assert.equal(await dimmer.count(), 1, `${sourcePart} code editing must keep the video dimmed`);
  }

  await restartFocus();
  const entrance = await seekFocusEntrance(.35);
  assert(entrance.animation && entrance.dimmerAnimation,
    `Entering Advanced must animate the component and dimmer: ${JSON.stringify(entrance)}`);
  assert(entrance.duration > 0 && entrance.duration < 1000 && entrance.dimDuration > 0 && entrance.dimDuration < 1000,
    "Code focus animations must be brief and finite");
  for (const axis of ["x", "y"]) {
    assert((entrance.middle[axis] - entrance.from[axis]) * (entrance.to[axis] - entrance.middle[axis]) > 1,
      `The Form must travel toward preview center during code focus (${axis})`);
  }
  assert(entrance.dimFrom < entrance.dimMiddle && entrance.dimMiddle < entrance.dimTo,
    "The video dimmer must fade in during code focus");

  await restartFocus();
  const interrupted = await seekFocusEntrance(.35, false);
  assert(interrupted.animation, "The Form must animate on a later code focus");
  const contactFrame = await focused.boundingBox();
  assert(contactFrame, "The lifted Form must be available for pointer contact");
  await page.mouse.move(contactFrame.x + contactFrame.width / 2, contactFrame.y + contactFrame.height / 2);
  await page.mouse.down();
  await page.mouse.move(contactFrame.x + contactFrame.width / 2 + 12,
    contactFrame.y + contactFrame.height / 2 + 9, { steps: 4 });
  await page.mouse.up();
  await focused.waitFor({ state: "detached" });
  assert.equal(await dimmer.count(), 0, "First preview contact must exit code focus");
  const afterContact = await assertPlacementMode("First preview contact");
  const contactPosition = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { x: component.x, y: component.y };
  });
  assert.deepEqual(contactPosition, placed.position,
    "First preview contact must not move the authored component");

  const placementFrame = await selected.boundingBox();
  const nextStart = {
    x: placementFrame.x + placementFrame.width / 2,
    y: placementFrame.y + placementFrame.height / 2,
  };
  await page.mouse.move(nextStart.x, nextStart.y);
  await page.mouse.down();
  await page.mouse.move(nextStart.x + 12, nextStart.y + 9, { steps: 4 });
  await page.mouse.up();
  const secondDrag = await assertPlacementMode("Drag after leaving code focus");
  const afterSecondDrag = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { position: { x: component.x, y: component.y }, animation: component.animation };
  });
  assertNear((afterSecondDrag.position.x - contactPosition.x) / 100 * afterContact.width, 12,
    "The next drag must update base X after leaving code focus");
  assertNear((afterSecondDrag.position.y - contactPosition.y) / 100 * afterContact.height, 9,
    "The next drag must update base Y after leaving code focus");
  assert.equal(afterSecondDrag.animation, undefined,
    "Leaving code focus must not turn the next drag into a keyframe edit");
  assertNear(secondDrag.center.x - afterContact.center.x, 12,
    "The Form must follow the next horizontal drag");
  assertNear(secondDrag.center.y - afterContact.center.y, 9,
    "The Form must follow the next vertical drag");

  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
  const formId = await page.evaluate(() => window.selectionFocusFixture.formId);
  const timelineBar = page.locator(`[data-kind="component"][data-layer-id="component:${formId}"]`);
  await timelineBar.click();
  await focused.waitFor({ state: "detached" });
  await assertPlacementMode("Desktop timeline component contact");
  const afterTimelineContact = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { x: component.x, y: component.y };
  });
  assert.deepEqual(afterTimelineContact, afterSecondDrag.position,
    "Timeline contact must end code focus without changing authored placement");

  await page.getByRole("tab", { name: "Look", exact: true }).click();
  await page.locator("[data-keyframe-editor]")
    .getByRole("button", { name: "Add Position keyframe", exact: true }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
  const keyframeControl = page.locator('[data-keyframe-lane="position"] [data-keyframe-control]').first();
  await keyframeControl.waitFor();
  const beforeKeyframeContact = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { position: { x: component.x, y: component.y }, animation: component.animation };
  });
  await keyframeControl.click();
  await focused.waitFor({ state: "detached" });
  await assertPlacementMode("Desktop keyframe timeline contact");
  const afterKeyframeContact = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { position: { x: component.x, y: component.y }, animation: component.animation };
  });
  assert.deepEqual(afterKeyframeContact, beforeKeyframeContact,
    "Selecting a timeline keyframe must leave authored placement and animation unchanged");

  const selectedKeyFrame = await selected.boundingBox();
  assert(selectedKeyFrame, "The explicitly selected Position key must keep the Form on the preview");
  const keyDragStart = { x: selectedKeyFrame.x + selectedKeyFrame.width / 2,
    y: selectedKeyFrame.y + selectedKeyFrame.height / 2 };
  await page.mouse.move(keyDragStart.x, keyDragStart.y);
  await page.mouse.down();
  await page.mouse.move(keyDragStart.x + 12, keyDragStart.y + 9, { steps: 4 });
  await page.mouse.up();
  await assertPlacementMode("Selected Position keyframe drag");
  const afterKeyDrag = await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    const component = store.getState().components.find(item => item.id === formId);
    return { position: { x: component.x, y: component.y }, animation: component.animation };
  });
  assert.deepEqual(afterKeyDrag.position, afterKeyframeContact.position,
    "Dragging an explicitly selected Position key must retain base placement");
  assert.notDeepEqual(afterKeyDrag.animation, afterKeyframeContact.animation,
    "Dragging an explicitly selected Position key must change its curve");

  await restartFocus();
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ sheet: "animation" }));
  await focused.waitFor({ state: "detached" });
  await assertPlacementMode("Animation sheet");
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ sheet: "component" }));

  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.locator('.pvBox[data-trying="true"]').waitFor();
  assert.equal(await dimmer.count(), 0, "Try must show the video without code focus");
  assert.equal(await focused.count(), 0, "Try must not lift the code selection");
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await restartFocus();
  const reduced = await focused.evaluate(element => {
    const dim = element.closest(".pvBox").querySelector("[data-component-focus-dimmer]");
    return {
      component: getComputedStyle(element).animationName,
      dimmer: getComputedStyle(dim).animationName,
      componentAnimations: element.getAnimations().length,
      dimmerAnimations: dim.getAnimations().length,
    };
  });
  assert.deepEqual(reduced, {
    component: "none", dimmer: "none", componentAnimations: 0, dimmerAnimations: 0,
  }, "Reduced motion must suppress both code focus animations");
  const reducedGeometry = await selectedGeometry();
  assertNear(reducedGeometry.center.x, reducedGeometry.previewCenter.x,
    "Reduced motion must still center the Form horizontally while editing code");
  assertNear(reducedGeometry.center.y, reducedGeometry.previewCenter.y,
    "Reduced motion must still center the Form vertically while editing code");

  await page.evaluate(() => {
    const { store, textId } = window.selectionFocusFixture;
    store.getState().patch({ sel: -1, selComp: null, selText: textId, sheet: "text" });
  });
  await page.locator('.textOverlay[data-sel="true"]').waitFor();
  assert.equal(await dimmer.count(), 0, "Text selection must not dim the video");
  assert.equal(await focused.count(), 0, "Text selection must not focus a component");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const { store, formId } = window.selectionFocusFixture;
    store.getState().patch({ sel: -1, selComp: formId, selText: null, sheet: "component" });
  });
  await page.locator('.pvBox[data-desktop="false"]').waitFor();
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await focused.waitFor({ state: "detached" });
  await assertPlacementMode("Mobile component sheet Content");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await focused.waitFor();
  await dimmer.waitFor();
  await page.evaluate(() => window.selectionFocusFixture.store.getState().patch({ sheet: null }));
  await focused.waitFor({ state: "detached" });
  assert.equal(await dimmer.count(), 0, "Closing the mobile component sheet must end code preview focus");

  assert.deepEqual(errors, [], "The preview must not raise browser errors");
  console.log("Component code focus passed: placement, Content/Look/Action, Structure/Style/Logic animation, preview/timeline/keyframe exit, animation sheet, Try, reduced motion, mobile sheet gating.");
} finally {
  await context.close();
  await browser.close();
}
