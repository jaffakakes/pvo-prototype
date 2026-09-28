import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

const url = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true, permissions: [] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();

  const choiceSheet = page.getByRole("dialog", { name: "Choice" });
  assert.equal(await choiceSheet.locator(".componentOptionRow").count(), 2, "Choice must show exactly two option rows");
  assert.equal(await choiceSheet.getByRole("button", { name: /Add option|Remove option/ }).count(), 0, "Choice options must not be added or removed");
  await choiceSheet.getByRole("textbox", { name: "Option 1 label" }).fill("Option one");
  await choiceSheet.getByRole("textbox", { name: "Option 2 label" }).fill("Option two");
  await choiceSheet.getByRole("button", { name: "Close" }).click();
  assert.equal(await page.locator(".compChoice button").count(), 2, "Preview must render exactly two Choice buttons");
  assert.deepEqual(await page.locator(".compChoice button").allTextContents(), ["Option one", "Option two"]);

  await page.getByRole("button", { name: "Next" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export" });
  const downloadPromise = page.waitForEvent("download", { timeout: 45000 });
  await exportDialog.getByRole("button", { name: "Export .pvo" }).click();
  const download = await downloadPromise;
  const decoded = await readPvoProject(new Blob([await readFile(await download.path())]));
  assert.equal(decoded.validation.valid, true, JSON.stringify(decoded.validation.errors));
  const choice = decoded.manifest.components.find(component => component.kind === "choice");
  assert.deepEqual(choice?.options?.map(option => option.label), ["Option one", "Option two"], "Interactive export must preserve exactly two options");
  assert.equal(choice?.restyle_capture?.outcomes?.length, 2, "Choice outcome count must match its two options");
  assert.deepEqual(errors, [], "Browser must not report uncaught errors");
  console.log("Choice two-option regression passed: editor, preview and interactive export.");
} finally {
  await browser.close();
}
