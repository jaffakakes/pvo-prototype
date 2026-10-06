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
  await page.route("**/api/auth/session", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: { id: "components-check", name: "Components check" } }) }));
  await page.route("**/api/renders", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ available: false, maxSourceBytes: 0, maxSources: 0, formats: [] }) }));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await recordDemo(1200);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("heading", { name: "Edit" }).waitFor();
  const editorSummary = page.locator("header.editorHead p");
  assert.ok(!(await editorSummary.textContent())?.includes("$"), "Editor subtitle should not contain template punctuation");

  // Fields-route authoring: create a Choice, change its copy, and link Option A to a new scene.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-picker.png") });
  await page.getByRole("button", { name: /Let viewers choose/ }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-fields.png") });
  const choiceSheet = page.getByRole("dialog", { name: "Choice" });
  await choiceSheet.getByRole("textbox", { name: "Prompt" }).fill("Choose a look");
  await choiceSheet.getByRole("textbox", { name: "Option 1" }).fill("Go B");
  await choiceSheet.getByRole("tab", { name: "Action", exact: true }).click();
  await choiceSheet.getByRole("switch", { name: "Pause if nobody responds" }).click();
  await choiceSheet.getByRole("button", { name: /When viewers tap “Go B”/ }).click();
  await choiceSheet.getByRole("button", { name: /Go to a scene/ }).click();
  await page.getByRole("button", { name: "＋ New scene" }).click();
  await page.locator(".sceneBanner").getByText(/Scene A.*Go B/).waitFor();
  await recordDemo(750);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.locator(".sceneChip[data-on='true']").getByText(/Scene A/).waitFor();

  // A second component proves that media and component lists are scoped to each scene.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.getByRole("button", { name: /Add a note/ }).click();
  await page.getByRole("dialog", { name: "Note" }).getByRole("textbox", { name: "Text" }).fill("Scene A note");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: resolve(tmpdir(), "restyle-components-editor.png") });
  assert.equal(await page.locator(".compBar, .compMarker").count(), 1, "Scene A should show only its Tooltip lane item");
  await page.locator(".sceneChip").filter({ hasText: "Main" }).click();
  assert.equal(await page.locator(".compBar, .compMarker").count(), 1, "Main should show only its Choice lane item");

  // Try mode hides the scene row, routes to Scene A, then restores the Main editing location.
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.getByRole("button", { name: "Stop trying", exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Go B", exact: true }).click();
  await page.locator("header.editorHead[data-trying='true'] p")
    .filter({ hasText: "Tap like a viewer · Scene A" }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole("button", { name: "Show the whole scene tree" }).count(), 0);
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  await editorSummary.filter({ hasText: /^Main ·/ }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Try", exact: true }).waitFor({ timeout: 5000 });

  // Interactive export contains the Main scene and its branch.
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("dialog", { name: "More" })
    .getByRole("button", { name: "Export and create link", exact: true }).click();
  const exportDialog = page.locator("dialog[data-state]");
  await exportDialog.getByRole("button", { name: /Export and share/ }).waitFor();
  assert.equal(await exportDialog.getByRole("combobox", { name: "Export format" }).count(),
    0, "Only PVO export should be offered");
  await exportDialog.getByRole("button", { name: /Export and share/ }).click();
  await page.locator('dialog[data-state="done"]').waitFor({ timeout: 60000 });
  const share = page.getByRole("dialog", { name: "Share export", exact: true });
  await share.waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    share.locator("[data-download-again]").click(),
  ]);
  assert.match(download.suggestedFilename(), /\.pvo$/, "Interactive export must download as PVO");
  const decoded = await readPvoProject(new Blob([await readFile(await download.path())]));
  assert.equal(decoded.validation.valid, true, JSON.stringify(decoded.validation.errors));
  assert.equal(decoded.manifest.scenes.length, 2);
  assert.equal(decoded.assets.length, 9, "Two scene videos, three PVO source files per component and the selected cover should be packaged");
  assert(decoded.assets.some(asset => asset.id === "poster" && asset.type === "image/webp"),
    "Interactive export must package the selected WebP cover");
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
  const viewerChoice = viewer.locator("pvo-component-view").filter({ hasText: "Choose a look" });
  await viewerChoice.getByRole("button", { name: "Go B" }).waitFor({ state: "visible", timeout: 10000 });
  await viewer.waitForTimeout(400);
  await viewerChoice.getByRole("button", { name: "Go B" }).click();
  await viewer.locator(`[data-asset-id="${branch.asset_id}"]`).waitFor({ timeout: 10000 });
  assert.deepEqual(pageErrors, [], "The editor should not report page errors");
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
