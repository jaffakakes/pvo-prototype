import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));

const CANVAS = { width: 1080, height: 1920 };

async function settle() {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

async function historyLength() {
  return page.evaluate(() => window.positionCapture.getState().past.length);
}

async function position(kind) {
  return page.evaluate(kind => {
    const state = window.positionCapture.getState();
    const id = window.positionIds[kind];
    const item = kind === "text"
      ? state.texts.find(value => value.id === id)
      : state.components.find(value => value.id === id);
    return { x: item.x, y: item.y };
  }, kind);
}

async function canvasCenter(target) {
  await settle();
  return target.evaluate((element, canvas) => {
    const preview = document.querySelector(".pvBox").getBoundingClientRect();
    if (element.classList.contains("textOverlay")) {
      // Text is painted into the full-size canvas; the transparent button's inline box
      // mirrors the painter layout even when selection styling transforms that button.
      return {
        x: (Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width) / 2) / preview.width * canvas.width,
        y: (Number.parseFloat(element.style.top) + Number.parseFloat(element.style.height) / 2) / preview.height * canvas.height,
      };
    }
    const bounds = element.getBoundingClientRect();
    return {
      x: (bounds.left + bounds.width / 2 - preview.left) / preview.width * canvas.width,
      y: (bounds.top + bounds.height / 2 - preview.top) / preview.height * canvas.height,
    };
  }, CANVAS);
}

function assertNear(actual, expected, message, tolerance = 12) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

async function assertPosition(scope, target, expected, message) {
  const xField = scope.getByRole("spinbutton", { name: "X position (px)", exact: true });
  const yField = scope.getByRole("spinbutton", { name: "Y position (px)", exact: true });
  assert.equal(await xField.inputValue(), String(expected.x), `${message}: X field`);
  assert.equal(await yField.inputValue(), String(expected.y), `${message}: Y field`);
  const center = await canvasCenter(target);
  assertNear(center.x, expected.x, `${message}: visible X`);
  assertNear(center.y, expected.y, `${message}: visible Y`);
  return { xField, yField };
}

async function assertPixelContract(scope) {
  const controls = scope.locator("[data-layer-position-controls]");
  await controls.getByRole("heading", { name: "Position", exact: true }).waitFor();
  await controls.getByText("Layer centre in pixels from the top-left of the 1080 × 1920 canvas.", { exact: true }).waitFor();
  const xField = controls.getByRole("spinbutton", { name: "X position (px)", exact: true });
  const yField = controls.getByRole("spinbutton", { name: "Y position (px)", exact: true });
  assert.equal(await xField.getAttribute("min"), "87");
  assert.equal(await xField.getAttribute("max"), "993");
  assert.equal(await yField.getAttribute("min"), "116");
  assert.equal(await yField.getAttribute("max"), "1804");
}

async function select(kind) {
  await page.evaluate(kind => {
    const state = window.positionCapture.getState();
    const id = window.positionIds[kind];
    state.patch(kind === "text"
      ? { sel: -1, selText: id, selComp: null, sheet: "text", playing: false }
      : { sel: -1, selText: null, selComp: id, sheet: "component", playing: false });
  }, kind);
  await settle();
}

try {
  const response = await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `Editor did not load at ${editorUrl}`);
  await page.evaluate(async () => {
    const { mkClip, useCapture } = await import("/src/store.ts");
    const clip = mkClip(20, null, 0);
    const scene = {
      id: "main", name: "Main", parent: null,
      clips: [clip], audioClips: [], texts: [], components: [],
      muted: true, sound: -1, layers: ["video"],
    };
    useCapture.setState({
      scenes: [scene], currentSceneId: "main", clips: [clip], audioClips: [], texts: [], components: [],
      muted: true, sound: -1, layers: ["video"], ratio: "9:16", screen: "editor", sheet: null,
      t: 4, sel: -1, selText: null, selComp: null, selAudio: null,
      playing: false, tryMode: null, playheadPick: null, past: [], future: [],
    });
    const state = useCapture.getState();
    const text = state.addText("Pixel position");
    state.updateText(text, { x: 25, y: 75 });
    const component = state.addComponent("tooltip");
    state.updateComponent(component, { x: 50, y: 25 });
    state.patch({ sel: -1, selText: text, selComp: null, sheet: "text", past: [], future: [] });
    window.positionCapture = useCapture;
    window.positionIds = { text, component };
    await document.fonts.ready;
  });
  await page.locator("[data-desktop-editor]").waitFor();
  await page.locator(".textOverlay").waitFor();
  await page.locator(".compOverlay").waitFor();

  const inspector = page.locator("[data-desktop-inspector]");
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  await assertPixelContract(inspector);
  const textOverlay = page.locator(".textOverlay");
  let fields = await assertPosition(inspector, textOverlay, { x: 270, y: 1440 }, "Desktop text initial position");

  let history = await historyLength();
  await fields.xField.fill("360");
  await fields.xField.press("Enter");
  await settle();
  assert.equal(await historyLength(), history + 1, "Enter commits one text position history entry");
  assertNear((await position("text")).x, 360 / CANVAS.width * 100, "Enter stores the desktop text X coordinate", .001);
  fields = await assertPosition(inspector, textOverlay, { x: 360, y: 1440 }, "Desktop text after Enter");

  history = await historyLength();
  await fields.yField.fill("1200");
  await fields.yField.press("Tab");
  await settle();
  assert.equal(await historyLength(), history + 1, "Blur commits one text position history entry");
  fields = await assertPosition(inspector, textOverlay, { x: 360, y: 1200 }, "Desktop text after blur");

  history = await historyLength();
  await fields.xField.fill("500");
  await fields.xField.press("Escape");
  await fields.yField.fill("");
  await fields.yField.press("Enter");
  await settle();
  assert.equal(await historyLength(), history, "Escape and blank text coordinates do not add history");
  fields = await assertPosition(inspector, textOverlay, { x: 360, y: 1200 }, "Cancelled desktop text edits");

  await select("component");
  await inspector.getByRole("tab", { name: "Look", exact: true }).click();
  await assertPixelContract(inspector);
  const componentOverlay = page.locator(".compOverlay");
  fields = await assertPosition(inspector, componentOverlay, { x: 540, y: 480 }, "Desktop component initial position");
  history = await historyLength();
  await fields.xField.fill("648");
  await fields.xField.press("Enter");
  await settle();
  assert.equal(await historyLength(), history + 1, "Enter commits one component position history entry");
  fields = await assertPosition(inspector, componentOverlay, { x: 648, y: 480 }, "Desktop component after Enter");

  history = await historyLength();
  await page.evaluate(() => {
    const state = window.positionCapture.getState();
    state.updateComponent(window.positionIds.component, { x: 70, y: 30 }, false);
  });
  await settle();
  assert.equal(await historyLength(), history, "A live component position preview does not create history");
  fields = await assertPosition(inspector, componentOverlay, { x: 756, y: 576 }, "External component position update");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".editorWorkspace").waitFor();
  const componentSheet = page.getByRole("dialog", { name: "Note", exact: true });
  await componentSheet.waitFor();
  await assertPixelContract(componentSheet);
  fields = await assertPosition(componentSheet, componentOverlay, { x: 756, y: 576 }, "Mobile component retained position");
  history = await historyLength();
  await fields.yField.fill("720");
  await fields.yField.press("Tab");
  await settle();
  assert.equal(await historyLength(), history + 1, "Mobile blur commits one component position history entry");
  await assertPosition(componentSheet, componentOverlay, { x: 756, y: 720 }, "Mobile component after blur");

  await select("text");
  const textSheet = page.getByRole("dialog", { name: "Edit text", exact: true });
  await textSheet.getByRole("tab", { name: "Style", exact: true }).click();
  await assertPixelContract(textSheet);
  fields = await assertPosition(textSheet, textOverlay, { x: 360, y: 1200 }, "Mobile text retained position");
  history = await historyLength();
  await page.evaluate(() => {
    const state = window.positionCapture.getState();
    state.updateText(window.positionIds.text, { x: 45, y: 50 }, false);
  });
  await settle();
  assert.equal(await historyLength(), history, "A live text position preview does not create history");
  fields = await assertPosition(textSheet, textOverlay, { x: 486, y: 960 }, "External text position update");
  await fields.xField.fill("540");
  await fields.xField.press("Enter");
  await settle();
  assert.equal(await historyLength(), history + 1, "Mobile Enter commits one text position history entry");
  await assertPosition(textSheet, textOverlay, { x: 540, y: 960 }, "Mobile text after Enter");

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator("[data-desktop-editor]").waitFor();
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  await assertPixelContract(inspector);
  await assertPosition(inspector, textOverlay, { x: 540, y: 960 }, "Desktop text after responsive round trip");

  assert.deepEqual(errors, []);
  console.log("PASS: layer X/Y pixel controls commit and stay in sync for text and components on desktop and mobile.");
} catch (error) {
  console.error(`Layer position failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 2000)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
