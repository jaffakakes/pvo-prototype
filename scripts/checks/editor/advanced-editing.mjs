import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Prerequisites: a Vite editor server and Chrome (or CHROME_PATH).
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const preferenceKey = "restyle.editor.advancedEditing";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function recordClip() {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();
}

async function projectSnapshot() {
  // Assertions only: the user workflow below owns every preference and project edit.
  return page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const state = useCapture.getState();
    return {
      scenes: state.scenes,
      currentSceneId: state.currentSceneId,
      ratio: state.ratio,
      allowedDomains: state.allowedDomains,
      past: state.past,
      future: state.future,
    };
  });
}

async function openMore() {
  const componentSheet = page.getByRole("dialog", { name: "Choice", exact: true });
  if (await componentSheet.count()) await componentSheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".toolBar").waitFor({ state: "visible" });
  await page.locator(".editorWorkspace").evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  const collapse = page.getByRole("button", { name: "Collapse component tools" });
  if (await collapse.count()) await collapse.click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  return page.getByRole("dialog", { name: "More", exact: true });
}

async function setAdvancedEditing(enabled) {
  const more = await openMore();
  const toggle = more.getByRole("switch", { name: "Advanced editing", exact: true });
  assert.equal(await toggle.getAttribute("aria-checked"), String(!enabled));
  const before = await projectSnapshot();
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), String(enabled));
  assert.deepEqual(await projectSnapshot(), before, "Changing a device preference must preserve the project and undo/redo");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), String(enabled));
  await more.getByRole("button", { name: "Close", exact: true }).click();
}

async function openChoice() {
  await page.getByRole("button", { name: "Select component layer: choice", exact: true }).click();
  await page.locator(".tools").getByRole("button", { name: "Edit", exact: true }).click();
  return page.getByRole("dialog", { name: "Choice", exact: true });
}

try {
  const response = await page.goto(editorUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `Editor did not load at ${editorUrl}`);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), null);
  await recordClip();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  let sheet = page.getByRole("dialog", { name: "Choice", exact: true });
  assert.equal(await sheet.getByRole("tab", { name: "Advanced", exact: true }).count(), 0,
    "Advanced authoring must be opt-in for a fresh browser");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null);

  await setAdvancedEditing(true);
  sheet = await openChoice();
  await sheet.getByRole("tab", { name: "Advanced", exact: true }).click();
  const structure = sheet.getByRole("textbox", { name: "Structure source" });
  const savedStructure = (await structure.inputValue())
    .replace(/<prompt>[\s\S]*?<\/prompt>/, "<prompt>Preference test prompt</prompt>")
    .replace(/(<option id="option0">)[\s\S]*?(<\/option>)/, "$1Saved route$2");
  await structure.fill(savedStructure);
  const preview = page.locator(".compCustomRuntime iframe").first().contentFrame();
  await preview.getByRole("button", { name: "Saved route", exact: true }).waitFor();
  await sheet.getByRole("tab", { name: "Style", exact: true }).click();
  const style = sheet.getByRole("textbox", { name: "Style source" });
  const savedStyle = (await style.inputValue()).replace("background: #A78BFA;", "background: #2EC4B6;");
  await style.fill(savedStyle);
  await page.waitForFunction(() => {
    const option = document.querySelector(".compCustomRuntime iframe")?.contentDocument?.querySelector(".pvo-option");
    return option && getComputedStyle(option).backgroundColor === "rgb(46, 196, 182)";
  });

  await setAdvancedEditing(false);
  sheet = await openChoice();
  assert.equal(await sheet.getByRole("tab", { name: "Advanced", exact: true }).count(), 0);
  assert.equal(await sheet.getByRole("textbox", { name: /source$/ }).count(), 0);
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).inputValue(), "Saved route");
  assert.equal(await sheet.getByRole("textbox", { name: "Option 1 label" }).getAttribute("readonly"), null,
    "Fields must remain editable when Advanced is hidden");
  await preview.getByRole("button", { name: "Saved route", exact: true }).waitFor();
  assert.equal(await preview.locator(".pvo-option").first().evaluate(element => getComputedStyle(element).backgroundColor), "rgb(46, 196, 182)");
  await sheet.getByRole("textbox", { name: "Option 1 label" }).fill("Edited with code hidden");
  await preview.getByRole("button", { name: "Edited with code hidden", exact: true }).waitFor();
  assert.equal(await preview.locator(".pvo-option").first().evaluate(element => getComputedStyle(element).backgroundColor), "rgb(46, 196, 182)",
    "Editing Fields with Advanced hidden must preserve authored Style");
  if (process.env.PVO_ADVANCED_SCREENSHOT) await page.screenshot({ path: process.env.PVO_ADVANCED_SCREENSHOT });

  await setAdvancedEditing(true);
  sheet = await openChoice();
  await sheet.getByRole("tab", { name: "Advanced", exact: true }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Structure source" }).inputValue(), savedStructure.replace("Saved route", "Edited with code hidden"));
  await sheet.getByRole("tab", { name: "Style", exact: true }).click();
  assert.equal(await sheet.getByRole("textbox", { name: "Style source" }).inputValue(), savedStyle);

  await page.reload({ waitUntil: "networkidle" });
  if (await page.getByRole("button", { name: "Record", exact: true }).count()) await recordClip();
  const more = await openMore();
  assert.equal(await more.getByRole("switch", { name: "Advanced editing", exact: true }).getAttribute("aria-checked"), "true",
    "The device preference must survive a reload");
  await more.getByRole("button", { name: "Close", exact: true }).click();
  if (await page.getByRole("button", { name: "Select component layer: choice", exact: true }).count()) await openChoice();
  else {
    await page.getByRole("button", { name: "Components", exact: true }).click();
    await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  }
  assert.equal(await page.getByRole("dialog", { name: "Choice", exact: true }).getByRole("tab", { name: "Advanced", exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("Advanced editing passed: opt-in UI, editable Fields with Advanced hidden, source/Style preservation, independent history and saved preference.");
} catch (error) {
  console.error(`Advanced editing failed: ${error.stack}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1600)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
