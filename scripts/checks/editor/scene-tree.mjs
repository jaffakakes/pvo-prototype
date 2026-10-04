import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
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
const more = page.getByRole("dialog", { name: "More", exact: true });
const waitForLayout = () => page.waitForTimeout(280);

async function assertCurrent(name) {
  await page.waitForFunction(expected => document.querySelector('.scenesRow [aria-current="true"]')?.textContent.startsWith(expected), name);
  await waitForLayout();
  assert((await page.locator(".editorHead p").innerText()).startsWith(`${name} · `));
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
  await treeButton.click();
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

async function closeMore() {
  await more.getByRole("button", { name: "Close", exact: true }).click();
  await waitForLayout();
}

async function renameScene(name) {
  await page.locator(".toolBar").getByRole("button", { name: "More", exact: true }).click();
  await more.getByRole("button", { name: "Rename scene…", exact: true }).click();
  await more.getByRole("textbox", { name: "Scene name", exact: true }).fill(name);
  await more.getByRole("button", { name: "Save name", exact: true }).click();
  await closeMore();
  await assertCurrent(name);
}

async function firstOutcome() {
  const choice = page.getByRole("dialog", { name: "Choice", exact: true });
  await choice.waitFor();
  const actionTab = choice.getByRole("tab", { name: "Action", exact: true });
  if (await actionTab.count()) {
    await actionTab.click();
    await choice.getByRole("button", { name: /^When viewers tap/ }).first().click();
    return choice;
  }
  await choice.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  return page.getByRole("dialog", { name: /where\?/ });
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
  await tree.getByRole("button", { name: "Close scene tree", exact: true }).press("Escape");
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
  assert.deepEqual(await row.locator("button.sceneChip").allTextContents(), ["Street look 0:00▸2", "Evening look 0:00"]);
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Street look", "Scene i", "Scene 1", "Scene ii", "Evening look"]);
  await tree.getByRole("button", { name: /^Open Scene 1, level 4,/ }).click();
  await assertCurrent("Scene 1");
  assert.equal(await row.locator(".sceneChip").count(), 2, "A leaf row contains only parent and current scene chips");
  await openScene("Main");
  for (const width of [320, 390, 430]) await assertGeometry(width);

  await openTree();
  await page.locator(".toolBar").getByRole("button", { name: "More", exact: true }).click();
  await more.waitFor();
  assert.equal(await tree.count(), 0, "Opening a sheet must close the tree");
  await more.getByRole("switch", { name: "Reduce motion", exact: true }).click();
  await closeMore();
  await openTree();
  assert.equal(await tree.evaluate(element => getComputedStyle(element).animationName), "none");
  await tree.getByRole("button", { name: "Close scene tree", exact: true }).click();
  await openTree();
  await page.getByRole("button", { name: /^(Try|Try viewer preview)$/ }).first().click();
  assert.equal(await tree.count(), 0, "Starting Try must close the tree");
  assert.equal(await row.count(), 0, "Try hides scene navigation");
  await page.getByRole("button", { name: /^(Stop trying|Stop viewer preview)$/ }).first().click();
  await assertCurrent("Main");

  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: /Choice|Let viewers choose/ }).click();
  const outcome = await firstOutcome();
  await outcome.getByRole("button", { name: /Go to (a )?scene/ }).click();
  const destinations = outcome.locator(".sceneChoices");
  assert.equal(await destinations.getByRole("button").count(), 6, "Picker includes every other scene and New scene");
  await destinations.getByRole("button", { name: "Scene 1 0:00 branch of Scene i", exact: true }).click();
  await page.getByRole("separator", { name: "Resize editing panel", exact: true }).press("Escape");
  await waitForLayout();
  await openScene("Street look");
  await page.locator(".toolBar").getByRole("button", { name: "More", exact: true }).click();
  await more.getByRole("button", { name: "Delete scene…", exact: true }).click();
  assert.equal(await more.getByRole("list", { name: "Scenes to delete", exact: true }).locator("li").count(), 4);
  assert.equal(await more.getByRole("list", { name: "Affected components", exact: true }).locator("li").count(), 1);
  await more.getByRole("button", { name: "Delete scene", exact: true }).click();
  await assertCurrent("Main");
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Evening look"]);
  await tree.getByRole("button", { name: "Close scene tree", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await assertCurrent("Street look");
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Street look", "Scene i", "Scene 1", "Scene ii", "Evening look"]);
  await tree.getByRole("button", { name: /^Open Evening look, level 2,/ }).click();
  await page.locator(".toolBar").getByRole("button", { name: "More", exact: true }).click();
  await more.getByRole("button", { name: "Duplicate scene", exact: true }).click();
  await assertCurrent("Evening look copy");
  await goUp("Main");
  assert.equal(await row.getByRole("button", { name: "Open Evening look copy", exact: true }).count(), 1);

  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentList button").first().click();
  const newSceneOutcome = await firstOutcome();
  await newSceneOutcome.getByRole("button", { name: /New scene/ }).click();
  await page.locator(".sceneBanner").waitFor();
  assert.match(await page.locator(".sceneBanner").innerText(), /Scene A · plays after “Option A”/);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await assertCurrent("Main");
  await openTree();
  assert.deepEqual(await treeNames(), ["Main", "Street look", "Scene i", "Scene 1", "Scene ii", "Evening look", "Evening look copy"],
    "One undo must remove the new destination scene");
  await tree.getByRole("button", { name: "Close scene tree", exact: true }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentList button").first().click();
  const restoredOutcome = await firstOutcome();
  assert.match(await restoredOutcome.locator('.sceneChoices [aria-pressed="true"]').innerText(), /Scene 1/,
    "The same undo must restore the previous component route");
  await page.getByRole("separator", { name: "Resize editing panel", exact: true }).press("Escape");
  await waitForLayout();
  await page.getByRole("separator", { name: "Resize timeline", exact: true }).press("ArrowUp");
  await page.getByRole("separator", { name: "Resize timeline", exact: true }).press("ArrowUp");
  await page.getByRole("separator", { name: "Resize timeline", exact: true }).press("ArrowUp");
  await openTree();
  assert.equal(await page.locator('[data-assistant-region][data-active="false"]').isVisible(), false,
    "The floating assistant must not obscure tree nodes");
  if (process.env.PVO_SCENE_TREE_SCREENSHOT) await page.screenshot({ path: process.env.PVO_SCENE_TREE_SCREENSHOT });
  await tree.getByRole("button", { name: "Close scene tree", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).first().click();
  await more.getByRole("switch", { name: "Reduce motion", exact: true }).click();
  await closeMore();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTree();
  assert.equal(await tree.evaluate(element => getComputedStyle(element).animationName), "none");
  assert.deepEqual(errors, [], "Scene workflows must not produce browser errors");
  console.log("Scene tree passed: depth naming, parent/child navigation, DFS, pinned mobile overflow, lane-only overlay, focus, sheet/Try dismissal, motion, destination ancestry, rename, subtree delete/undo, sibling duplication, routed camera and atomic undo.");
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
