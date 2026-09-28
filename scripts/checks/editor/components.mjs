import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));

async function recordDemo(milliseconds) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(milliseconds);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).waitFor();
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await recordDemo(1200);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("heading", { name: "Edit" }).waitFor();
  assert.ok(!(await page.locator(".editorTitle p").textContent())?.includes("$"), "Editor subtitle should not contain template punctuation");

  // Fields-route authoring: create a Choice, change its copy, and link Option A to a new scene.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-picker.png") });
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-fields.png") });
  const choiceSheet = page.getByRole("dialog", { name: "Choice" });
  await choiceSheet.locator("input.componentInput").first().fill("Choose a look");
  await choiceSheet.getByRole("textbox", { name: "Option 1 label" }).fill("Go B");
  await choiceSheet.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  await page.getByRole("dialog", { name: /Go B.*where/ }).waitFor();
  await page.getByRole("button", { name: /Go to scene/ }).click();
  await page.getByRole("button", { name: "＋ New scene" }).click();
  await page.locator(".sceneBanner").getByText(/Scene A.*Go B/).waitFor();
  await recordDemo(750);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.locator(".sceneChip[data-on='true']").getByText(/Scene A/).waitFor();

  // A second component proves that media and component lists are scoped to each scene.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Tooltip" }).click();
  await page.getByRole("dialog", { name: "Tooltip" }).locator("input.componentInput").fill("Scene A note");
  await page.getByRole("button", { name: "Close" }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-editor.png") });
  assert.equal(await page.locator(".compBar, .compMarker").count(), 1, "Scene A should show only its Tooltip lane item");
  await page.locator(".sceneChip").filter({ hasText: "Main" }).click();
  assert.equal(await page.locator(".compBar, .compMarker").count(), 1, "Main should show only its Choice lane item");

  // Try mode hides the scene row, routes to Scene A, then returns to Main.
  await page.getByRole("button", { name: "Try viewer preview" }).click();
  await page.locator(".holdTag").waitFor({ timeout: 5000 });
  await page.locator(".compChoice").getByRole("button", { name: "Go B" }).click();
  await page.locator(".editorTitle p").filter({ hasText: /^Scene A ·/ }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole("button", { name: "Show the whole scene tree" }).count(), 0);
  let tryFailure = "";
  try {
    await page.locator(".editorTitle p").filter({ hasText: /^Main ·/ }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Try viewer preview" }).waitFor({ timeout: 5000 });
  } catch (error) {
    tryFailure = `Try mode did not finish after returning from Scene A: ${error.message}`;
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  }

  // Interactive export contains the Main scene and its branch.
  await page.getByRole("button", { name: "Next" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export" });
  await exportDialog.getByRole("button", { name: /Interactive/ }).waitFor();
  assert.equal(await exportDialog.getByRole("button", { name: /Interactive/ }).getAttribute("data-on"), "true", "Interactive should be preselected");
  const downloadPromise = page.waitForEvent("download", { timeout: 45000 });
  await exportDialog.getByRole("button", { name: "Export .pvo" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "restyle-video.pvo");
  const decoded = await readPvoProject(new Blob([await readFile(await download.path())]));
  assert.equal(decoded.validation.valid, true, JSON.stringify(decoded.validation.errors));
  assert.equal(decoded.manifest.scenes.length, 2);
  assert.equal(decoded.assets.length, 8, "Two scene videos and three PVO source files for each component should be packaged");
  assert.equal(decoded.assets.some(asset => /\.(?:html|css|js)$/.test(asset.path)), false,
    "Retired HTML/CSS/JavaScript component assets must not be packaged");
  const main = decoded.manifest.scenes.find(scene => scene.id === "main");
  const branch = decoded.manifest.scenes.find(scene => scene.label === "Scene A");
  assert.ok(main && branch, "Main and Scene A must both be packaged");
  assert.equal(main.parent, null);
  assert.equal(branch.parent, main.id);
  const choice = decoded.manifest.components.find(component => component.kind === "choice");
  const tooltip = decoded.manifest.components.find(component => component.kind === "tooltip");
  assert.equal(choice?.title, "Choose a look");
  assert.equal(choice?.options?.[0]?.label, "Go B");
  assert.deepEqual(choice?.options?.[0]?.action, { type: "goto_scene", scene: branch.id });
  assert.equal(tooltip?.text, "Scene A note");
  assert.equal(tooltip?.presentation?.scene, branch.id);
  const viewer = await context.newPage();
  await viewer.goto(process.env.PVO_PLAYER_URL || new URL("../player/", editorUrl).href, { waitUntil: "networkidle" });
  await viewer.locator("#pvoInput").setInputFiles(await download.path());
  await viewer.locator("#playerShell").waitFor({ state: "visible", timeout: 10000 });
  const choiceFrame = viewer.locator(".code-position iframe").first().contentFrame();
  await choiceFrame.getByRole("button", { name: "Go B" }).waitFor({ state: "visible", timeout: 10000 });
  await viewer.waitForTimeout(400);
  await choiceFrame.getByRole("button", { name: "Go B" }).click();
  await viewer.locator(`[data-asset-id="${branch.asset_id}"]`).waitFor({ timeout: 10000 });
  assert.deepEqual(pageErrors, [], "The editor should not report page errors");
  assert.equal(tryFailure, "", tryFailure);
  console.log("Components E2E passed: Fields Choice + Tooltip, Try route, PVO-only export, and exported package playback.");
} catch (error) {
  console.error(`Components E2E failed: ${error.message}`);
  console.error(`Current URL: ${page.url()}`);
  console.error(`Page errors: ${pageErrors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => ""))?.slice(0, 1400)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
