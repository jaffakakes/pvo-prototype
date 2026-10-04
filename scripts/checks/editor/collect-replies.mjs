import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { readPvoProject } from "../../../packages/pvo-sdk/index.js";

// Run against a built local beta server with an isolated PVO_LOCAL_DATA_DIR.
// Account status is a fixture and remote rendering is disabled; reply storage and viewer POST use the real local API.
const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:4187/editor/";
const origin = new URL(editorUrl).origin;
if (!/^(127\.0\.0\.1|localhost)$/.test(new URL(editorUrl).hostname))
  throw new Error("Collect replies browser check requires a local beta server.");
const candidates = [process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  "/usr/bin/google-chrome", "/usr/bin/chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean);
const chromePath = candidates.find(path => existsSync(path));
if (!chromePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable.");
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const creatorContext = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true });
const viewerContext = await browser.newContext({ viewport: { width: 430, height: 932 } });
const creator = await creatorContext.newPage();
const viewer = await viewerContext.newPage();
await creator.route(`${origin}/api/auth/session`, route => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: { id: "replies-e2e", name: "Test creator" } }),
}));
await creator.route(`${origin}/api/renders`, route => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ available: false, maxSourceBytes: 0, maxSources: 0, formats: [], qualities: [] }),
}));
creator.setDefaultTimeout(12000);
viewer.setDefaultTimeout(12000);
const errors = [];
creator.on("pageerror", error => errors.push(`editor: ${error.message}`));
viewer.on("pageerror", error => errors.push(`viewer: ${error.message}`));
let box = null;
let deleted = false;
let editorPosts = 0;
creator.on("request", request => {
  if (request.method() === "POST" && /^\/api\/reply-boxes\/[^/]+\/replies$/.test(new URL(request.url()).pathname))
    editorPosts += 1;
});

async function boxes() {
  return creator.evaluate(async () => {
    const response = await fetch("/api/reply-boxes", { cache: "no-store" });
    if (!response.ok) throw new Error(`Reply boxes returned ${response.status}`);
    return (await response.json()).boxes;
  });
}

async function replies(id) {
  return creator.evaluate(async id => {
    const response = await fetch(`/api/reply-boxes/${id}/replies`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Inbox returned ${response.status}`);
    return (await response.json()).replies;
  }, id);
}

try {
  await creator.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = creator.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await creator.locator('input[type="file"]').setInputFiles(videoFile);
  await creator.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await creator.locator(".editorWorkspace").waitFor();

  await creator.getByRole("button", { name: "Components", exact: true }).click();
  await creator.locator(".componentTypeTile").filter({ hasText: "Ask for details" }).click();
  const formSheet = creator.getByRole("dialog", { name: "Form" });
  await formSheet.getByRole("textbox", { name: "Heading" }).fill("Questions for video");
  await formSheet.getByRole("textbox", { name: "Field 1 name" }).fill("Name");
  await formSheet.getByRole("textbox", { name: "Submit button" }).fill("Send answer");
  await formSheet.getByRole("tab", { name: "Action", exact: true }).click();
  const pause = formSheet.getByRole("switch", { name: "Pause if nobody responds" });
  if (await pause.getAttribute("aria-checked") !== "true") await pause.click();
  await formSheet.getByRole("button", { name: "Set up Collect replies" }).click();
  await formSheet.getByText("Collect replies is on", { exact: true }).waitFor();
  const ownedBoxes = await boxes();
  assert.equal(ownedBoxes.length, 1, "Authoring a Form should provision one reply box");
  box = ownedBoxes[0];
  assert.equal(box.title, "Questions for video");
  assert.equal(box.count, 0);
  assert.equal(box.url, `${origin}/api/reply-boxes/${box.id}/replies`);
  await formSheet.getByRole("button", { name: "Done", exact: true }).click();

  await creator.getByRole("button", { name: "Try", exact: true }).click();
  const tryForm = creator.locator(".compForm");
  await tryForm.getByLabel("Name", { exact: true }).fill("Try mode only");
  await tryForm.getByRole("button", { name: "Send answer" }).click();
  await creator.waitForTimeout(500);
  assert.equal(editorPosts, 0, "Try should simulate Collect replies without sending a request");
  assert.equal((await replies(box.id)).length, 0, "Try must leave the inbox empty");
  await creator.getByRole("button", { name: "Stop trying", exact: true }).click();

  await creator.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await creator.getByRole("dialog", { name: "More" })
    .getByRole("button", { name: "Interactive (.pvo)", exact: true }).click();
  const exportDialog = creator.locator("dialog[data-state]");
  await exportDialog.getByRole("button", { name: /Export \.pvo/ }).click();
  await creator.locator('dialog[data-state="done"]').waitFor({ timeout: 60000 });
  const [download] = await Promise.all([
    creator.waitForEvent("download", { timeout: 15000 }),
    exportDialog.getByRole("button", { name: /Download/ }).click(),
  ]);
  assert.equal(await download.failure(), null);
  const packageBytes = await readFile(await download.path());
  const packageView = await readPvoProject(new Blob([packageBytes]));
  assert.equal(packageView.validation.valid, true, JSON.stringify(packageView.validation.errors));
  const manifestForm = packageView.manifest.components.find(component => component.kind === "form");
  assert.equal(manifestForm?.on_submit?.type, "request");
  assert.equal(manifestForm.on_submit.url, box.url);
  assert.equal(manifestForm.restyle_capture?.form?.submitMode, "collect");
  await exportDialog.getByRole("button", { name: "Close export" }).click();

  await viewer.goto(`${origin}/player/`, { waitUntil: "networkidle" });
  await viewer.locator("#pvoInput").setInputFiles(await download.path());
  await viewer.locator("#playerShell").waitFor({ state: "visible" });
  const viewerForm = viewer.locator("pvo-component-view form");
  await viewerForm.getByLabel("Name", { exact: true }).fill("Viewer says hello");
  const sent = viewer.waitForResponse(response => response.url() === box.url
    && response.request().method() === "POST", { timeout: 15000 });
  await viewerForm.getByRole("button", { name: "Send answer" }).click();
  assert.equal((await sent).status(), 201, "The exported PVO should send through the public endpoint");
  await creator.waitForFunction(async id => {
    const response = await fetch(`/api/reply-boxes/${id}/replies`, { cache: "no-store" });
    return response.ok && (await response.json()).replies.length === 1;
  }, box.id);

  await creator.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  const more = creator.getByRole("dialog", { name: "More" });
  await more.getByRole("button", { name: "Open replies" }).click();
  await more.getByRole("button").filter({ hasText: "Questions for video" }).click();
  await more.getByText("Viewer says hello", { exact: true }).waitFor();
  assert.equal((await replies(box.id))[0].answers.find(answer => answer.name === "Name")?.value,
    "Viewer says hello");
  await more.getByRole("button", { name: "Delete this box…" }).click();
  await more.getByRole("button", { name: "Delete box and replies" }).click();
  deleted = true;
  const afterDelete = await viewer.evaluate(async url => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [{ name: "Name", type: "text", value: "Too late" }] }),
      credentials: "omit" });
    return response.status;
  }, box.url);
  assert.equal(afterDelete, 404, "Deleting the box must stop future viewer submissions");
  assert.deepEqual(errors, [], "The creator and viewer should not report page errors");
  console.log("Collect replies E2E passed: authoring, Try isolation, downloaded PVO submit, inbox, and deletion.");
} catch (error) {
  console.error(`Collect replies E2E failed: ${error.message}`);
  console.error(`Editor URL: ${creator.url()}; viewer URL: ${viewer.url()}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Editor UI: ${(await creator.locator("body").innerText().catch(() => "")).slice(0, 1400)}`);
  console.error(`Viewer UI: ${(await viewer.locator("body").innerText().catch(() => "")).slice(0, 1400)}`);
  process.exitCode = 1;
} finally {
  if (box && !deleted) {
    await creator.evaluate(async id => fetch(`/api/reply-boxes/${id}`, { method: "DELETE" }), box.id).catch(() => {});
  }
  await creatorContext.close();
  await viewerContext.close();
  await browser.close();
}
