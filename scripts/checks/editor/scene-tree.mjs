import { launchBrowser } from "../helpers/browser.mjs";
import { openEditorSettings, closeEditorSettings } from "../helpers/editor-settings.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";


const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await launchBrowser({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const row = page.getByRole("navigation", { name: "Scenes", exact: true });
const treeButton = page.getByRole("button", { name: "Show the whole scene tree", exact: true });
const tree = page.getByRole("region", { name: "Scene tree", exact: true });
const preferences = page.getByRole("dialog", { name: /^(Project settings|Editor settings)$/ });
const waitForLayout = () => page.waitForTimeout(280);

async function assertCurrent(name) {
  await page.waitForFunction(expected => document.querySelector('.scenesRow [aria-current="true"]')?.textContent.startsWith(expected), name);
  await waitForLayout();
  assert((await page.locator('.scenesRow [aria-current="true"]').innerText()).startsWith(name));
}

async function createScene(name) {
  await row.getByRole("button", { name: "New scene branching from here", exact: true }).click();
  await assertCurrent(name);
  await page.getByRole("button", { name: /Add clip$/ }).waitFor();
  assert.equal(await page.locator(".tlClip").count(), 0, "New branches must start empty");
}

async function goUp(name) {
  await row.getByRole("button", { name: `Up to the parent scene: ${name}`, exact: true }).click();
  await assertCurrent(name);
}

async function openTree() {
  if (await treeButton.getAttribute("aria-expanded") !== "true") await treeButton.click();
  await tree.waitFor();
  await waitForLayout();
}

async function treeNames() {
  return tree.locator("[data-scene-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label").split(", level ")[0].replace(/^Open /, "")));
}

async function openScene(name) {
  await openTree();
  await tree.getByRole("button", { name: new RegExp(`^Open ${name}, level `) }).click();
  await tree.waitFor({ state: "hidden" });
  await assertCurrent(name);
}

async function slideScene(name) {
  const button = tree.getByRole("button", { name: new RegExp(`^Open ${name}, level `) });
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  const x = bounds.x + bounds.width - 20;
  const y = bounds.y + bounds.height / 2;
  const client = await context.newCDPSession(page);
  try {
    const touch = (type, at) => client.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x: at, y, id: 1 }],
    });
    await touch("touchStart", x);
    for (let step = 1; step <= 10; step++) await touch("touchMove", x - step * 16);
    await touch("touchEnd", x - 160);
  } finally { await client.detach(); }
  await button.locator("..").getByRole("button", { name: `Rename ${name}`, exact: true }).waitFor();
  return button.locator("..");
}

async function renameScene(name) {
  const previous = await page.locator('.scenesRow [aria-current="true"]').innerText();
  const currentName = previous.replace(/\s+\d+:\d+.*$/, "");
  await openTree();
  const actions = await slideScene(currentName);
  assert.equal(await page.getByRole("dialog", { name: "More", exact: true }).count(), 0);
  assert.equal(await tree.getByRole("button", { name: /Duplicate/ }).count(), 0);
  await actions.getByRole("button", { name: `Rename ${currentName}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename scene", exact: true });
  await dialog.getByRole("textbox", { name: "Scene name", exact: true }).fill("   ");
  assert.equal(await dialog.getByRole("button", { name: "Save name", exact: true }).isDisabled(), true);
  await dialog.getByRole("textbox", { name: "Scene name", exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await treeButton.click();
  await assertCurrent(name);
}


async function assertGeometry(width) {
  await page.setViewportSize({ width, height: 844 });
  await waitForLayout();
  const geometry = await row.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const toggle = element.querySelector('[aria-label="Show the whole scene tree"]').getBoundingClientRect();
    const strip = element.firstElementChild;
    return {
      height: bounds.height,
      rowLeft: bounds.left,
      rowRight: bounds.right,
      buttonLeft: toggle.left,
      buttonRight: toggle.right,
      hitHeight: toggle.height,
      overflows: strip.scrollWidth > strip.clientWidth,
    };
  });
  assert.equal(geometry.height, 36);
  assert(geometry.buttonLeft >= geometry.rowLeft && geometry.buttonRight <= geometry.rowRight,
    `Tree button must stay pinned within the ${width}px row`);
  assert(geometry.hitHeight >= 44, "Tree button must retain its 44px hit area");
  assert(geometry.overflows, "The fixture should exercise overflowing branch chips");
  await row.locator(":scope > div").evaluate(strip => { strip.scrollLeft = strip.scrollWidth; });
  await openTree();
  const areas = await page.evaluate(() => {
    const rect = selector => {
      const { top, bottom, left, right } = document.querySelector(selector).getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return { tree: rect(".sceneTree"), row: rect(".scenesRow"), lanes: rect(".tl"), tools: rect(".toolBar"), preview: rect(".previewArea") };
  });
  assert(Math.abs(areas.tree.top - areas.row.bottom) <= 1, "Tree must start below the scenes row");
  assert(Math.abs(areas.tree.bottom - areas.tools.top) <= 1, "Tree must stop above the toolbar");
  assert(areas.tree.top >= areas.preview.bottom, "Tree must not cover the preview");
  assert.equal(await page.locator(".sheetScrim:visible").count(), 0, "The tree is not a modal sheet");
  assert.equal(await page.locator('.tl').evaluate(element => element.closest("[inert]") !== null), true,
    "Covered timeline controls must leave keyboard navigation");
  if (width === 430 && process.env.PVO_SCENE_TREE_SCREENSHOT)
    await page.screenshot({ path: process.env.PVO_SCENE_TREE_SCREENSHOT.replace(/\.png$/, "-layout.png") });
  await tree.getByRole("radio", { checked: true }).press("Escape");
  assert.equal(await treeButton.evaluate(element => element === document.activeElement), true, "Closing returns focus to the tree button");
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await assertCurrent("Main");
  assert.equal(await row.locator(".sceneChip").count(), 1, "Main-only projects must still show scene controls");

  await createScene("Scene A");
  await createScene("Scene i");
  await createScene("Scene 1");
  await goUp("Scene i");
  await goUp("Scene A");
  await createScene("Scene ii");
  await goUp("Scene A");
  await renameScene("Street look");
  await goUp("Main");
  await createScene("Scene A");
  await renameScene("Evening look");
  await goUp("Main");
  assert.deepEqual(await row.locator("button.sceneChip").allTextContents(), ["Street look 0:03▸2", "Evening look 0:00"]);
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Street look", "Scene i", "Scene 1", "Scene ii", "Evening look"]);
  await tree.getByRole("button", { name: /^Open Scene 1, level 4,/ }).click();
  await assertCurrent("Scene 1");
  assert.equal(await row.locator(".sceneChip").count(), 2, "A leaf row contains only parent and current scene chips");
  await openScene("Main");
  for (const width of [320, 390, 430]) await assertGeometry(width);

  await openEditorSettings(page);
  await preferences.getByRole("switch", { name: "Reduce motion", exact: true }).click();
  await closeEditorSettings(page);
  await openTree();
  assert.equal(await tree.evaluate(element => getComputedStyle(element).animationName), "none");
  await treeButton.click();
  await openTree();
  await page.getByRole("button", { name: /^(Try|Try viewer preview)$/ }).first().click();
  assert.equal(await tree.count(), 0, "Starting Try must close the tree");
  assert.equal(await row.count(), 0, "Try hides scene navigation");
  await page.getByRole("button", { name: /^(Stop trying|Stop viewer preview)$/ }).first().click();
  await assertCurrent("Main");

  // Use the existing project command boundary to make a routed deletion fixture.
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const state = useCapture.getState();
    const target = state.scenes.find(scene => scene.name === "Scene 1");
    const choice = state.components.find(component => component.type === "choice");
    state.updateOutcome(choice.id, { kind: "option", index: 0 }, { kind: "scene", sceneId: target.id });
  });
  await openScene("Street look");
  await openTree();
  const actions = await slideScene("Street look");
  await actions.getByRole("button", { name: "Delete Street look", exact: true }).click();
  const more = page.getByRole("dialog", { name: "Delete Street look?", exact: true });
  assert.equal(await more.getByRole("list", { name: "Scenes to delete", exact: true }).locator("li").count(), 4);
  assert(await more.getByRole("list", { name: "Affected components", exact: true }).locator("li").count() > 0);
  await more.getByRole("button", { name: "Keep scene", exact: true }).click();
  assert.equal(await treeNames().then(names => names.length), 6);
  await actions.getByRole("button", { name: "Delete Street look", exact: true }).click();
  await more.getByRole("button", { name: "Delete scene", exact: true }).click();
  await treeButton.click();
  await assertCurrent("Main");
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Evening look"]);
  await treeButton.click();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await assertCurrent("Street look");
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Street look", "Scene i", "Scene 1", "Scene ii", "Evening look"]);
  await tree.getByRole("button", { name: /^Open Evening look, level 2,/ }).click();
  await openTree();
  const evening = tree.getByRole("button", { name: /^Open Evening look, level 2,/ });
  await evening.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0 });
  await page.waitForTimeout(650);
  await evening.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 1 });
  assert.equal(await page.getByRole("dialog", { name: "More", exact: true }).count(), 0, "Holding a scene must not open the removed menu");
  await evening.click({ button: "right" });
  assert.equal(await page.getByRole("dialog").count(), 0, "Right click must not open a settings panel");
  await evening.focus();
  await evening.press("ArrowLeft");
  await evening.press("F2");
  await page.getByRole("dialog", { name: "Rename scene", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  await evening.press("Escape");
  await treeButton.click();
  await goUp("Main");

  await openTree();
  const main = tree.getByRole("button", { name: /^Open Main, level / });
  await main.press("Delete");
  assert.equal(await page.getByRole("dialog").count(), 0, "The main scene stays protected");
  const selected = await slideScene("Evening look");
  if (process.env.PVO_SCENE_TREE_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SCENE_TREE_SCREENSHOT });
  await selected.getByRole("button", { name: "Rename Evening look", exact: true }).click();
  await page.getByRole("dialog", { name: "Rename scene", exact: true }).press("Escape");
  assert.equal(await tree.isVisible(), true, "Escape dismisses the rename dialog without closing the tree");
  await treeButton.click();
  await openEditorSettings(page);
  await preferences.getByRole("switch", { name: "Reduce motion", exact: true }).click();
  await closeEditorSettings(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTree();
  assert.equal(await tree.evaluate(element => getComputedStyle(element).animationName), "none");
  await treeButton.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  const library = page.getByRole("tabpanel", { name: "Scenes", exact: true });
  const eveningDesktop = library.getByRole("button", { name: "Open Evening look", exact: true });
  await eveningDesktop.scrollIntoViewIfNeeded();
  const box = await eveningDesktop.boundingBox();
  await page.mouse.move(box.x + box.width - 16, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 176, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await library.getByRole("button", { name: "Rename Evening look", exact: true }).waitFor();
  if (process.env.PVO_SCENE_TREE_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SCENE_TREE_SCREENSHOT.replace(/\.png$/, "-desktop.png") });
  await library.getByRole("button", { name: "Rename Evening look", exact: true }).click();
  await page.getByRole("dialog", { name: "Rename scene", exact: true }).press("Escape");
  await eveningDesktop.press("Delete");
  await page.getByRole("dialog", { name: "Delete Evening look?", exact: true }).press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "More", exact: true }).count(), 0);
  await openEditorSettings(page);
  assert.equal(await preferences.getByRole("group", { name: "Color mode", exact: true }).count(), 1);
  assert.equal(await preferences.getByRole("button", { name: /Rename|Duplicate scene|Delete scene/ }).count(), 0);
  await closeEditorSettings(page);
  assert.deepEqual(errors, [], "Scene workflows must not produce browser errors");
  console.log("Scene tree passed: depth naming, parent/child navigation, DFS, pinned mobile overflow, lane-only overlay, focus, sheet/Try dismissal, motion, destination ancestry, rename, subtree delete/undo, touch slide actions, keyboard actions, cancelled rename/delete, no legacy menu, protected Main, focus restoration and reduced motion.");
} catch (error) {
  console.error(error.stack);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 2400)}`);
  if (process.env.PVO_SCENE_TREE_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SCENE_TREE_SCREENSHOT }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
