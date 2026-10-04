import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// The media renderer and downloads run unchanged. Only the same-origin publication
// service and the operating-system share sheet are substituted at their boundaries.
const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const screenshots = await mkdtemp(join(tmpdir(), "restyle-export-share-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const requests = { accountChecks: 0, statusChecks: 0, reservations: [], uploads: [], posters: [] };
let uploadMode = "fail";
let reserveMode = "ready";
let releaseUpload;
let releaseStatus;
let statusMode = "ready";
let available = true;
let accountUser = { id: "acceptance-account", name: "Acceptance creator" };
const publication = { id: "acceptance_video_1", url: `${origin}/player/acceptance_video_1`, status: "pending" };

await page.addInitScript(() => {
  window.exportObservation = { renders: 0, files: [], links: [] };
  const start = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...args) {
    window.exportObservation.renders++;
    return start.apply(this, args);
  };
  Object.defineProperty(navigator, "canShare", { configurable: true, value: data =>
    data.files?.length === 1 && data.files[0] instanceof File && data.files[0].size > 0 });
  Object.defineProperty(navigator, "share", { configurable: true, value: async data => {
    if (data.files) {
      const file = data.files[0];
      window.exportObservation.files.push({ name: file.name, type: file.type,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
    } else window.exportObservation.links.push(data.url);
    throw new DOMException("Share sheet dismissed", "AbortError");
  } });
});
const handleApi = async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const respond = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (pathname === "/api/auth/session" && request.method() === "GET") {
    requests.accountChecks++;
    return respond({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: accountUser });
  }
  if (pathname === "/api/auth/logout" && request.method() === "POST") {
    accountUser = null;
    return respond({ user: null });
  }
  if (pathname === "/api/renders" && request.method() === "GET")
    return respond({ available: false, maxSourceBytes: 0, maxSources: 0, formats: [] });
  if (pathname === "/api/publishing" && request.method() === "GET") {
    requests.statusChecks++;
    if (statusMode === "fail") return respond({ error: "Sharing status unavailable" }, 500);
    if (statusMode === "hold") await new Promise(resolve => { releaseStatus = resolve; });
    return respond({ available, hasSession: !!accountUser, maxBytes: 50 * 1024 * 1024 }).catch(() => {});
  }
  if (pathname === "/api/publications" && request.method() === "GET")
    return respond({ publications: [{ ...publication, title: "Acceptance video", format: "video", bytes: 10000,
      createdAt: "2026-01-01T00:00:00.000Z" }] });
  if (pathname === "/api/publications" && request.method() === "POST") {
    assert(accountUser, "The browser must sign in before reserving a publication");
    requests.reservations.push(request.postDataJSON());
    if (reserveMode === "expired") return respond({ error: "Reservation expired" }, 410);
    return respond(publication);
  }
  if (pathname === `/api/publications/${publication.id}/content` && request.method() === "PUT") {
    requests.uploads.push({ bytes: request.postDataBuffer(), type: request.headers()["content-type"] });
    if (uploadMode === "fail") return respond({ error: "Temporary upload failure" }, 500);
    if (uploadMode === "expired") return respond({ error: "Session expired during upload" }, 401);
    if (uploadMode === "hold") await new Promise(resolve => { releaseUpload = resolve; });
    return respond({ ...publication, status: "ready" }).catch(() => {});
  }
  if (pathname === `/api/publications/${publication.id}/poster` && request.method() === "PUT") {
    requests.posters.push({ bytes: request.postDataBuffer(), type: request.headers()["content-type"] });
    return respond({ uploaded: true }).catch(() => {});
  }
  throw new Error(`Unexpected publication operation: ${request.method()} ${pathname}`);
};
await page.route(`${origin}/api/**`, handleApi);

const exportDialog = page.locator("dialog[data-state]");
const share = page.getByRole("dialog", { name: "Share export", exact: true });
async function openExport() {
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Flat video", exact: true }).click();
  await exportDialog.waitFor();
}
async function reopenShare() {
  if (!await exportDialog.isVisible()) await openExport();
  await page.locator("[data-export-share]:visible").click();
  await share.getByLabel("Video title", { exact: true }).waitFor();
}
async function downloadAgain(expected) {
  const pending = page.waitForEvent("download");
  await share.locator("[data-download-again]").click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  assert.deepEqual(await readFile(await download.path()), expected, "Download again must retain the completed file byte for byte");
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await page.locator(".editorWorkspace").waitFor();
  await openExport();
  await exportDialog.getByRole("radiogroup", { name: "Export quality" }).getByRole("radio", { name: /^720p/ }).click();
  await exportDialog.getByRole("button", { name: /Export video/ }).click();
  await page.locator('dialog[data-state="done"]').waitFor({ timeout: 60000 });
  assert.equal(await share.count(), 0, "Finishing an export must keep optional sharing closed");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    exportDialog.getByRole("button", { name: /Download/ }).click(),
  ]);
  assert.equal(await download.failure(), null, "Explicit Download must save the completed file");
  const exported = await readFile(await download.path());
  assert(exported.length > 10000, "The real media export must contain video bytes");
  await exportDialog.locator("[data-export-share]:visible").click();
  await share.getByLabel("Video title", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.exportObservation.renders), 1);
  assert(requests.accountChecks > 0, "Export actions must check the account session");
  assert.equal(requests.reservations.length, 0, "Opening Share must not start an upload");
  assert.equal(requests.uploads.length, 0);
  assert.equal(requests.posters.length, 0, "Opening Share must not upload a cover");

  await share.locator("[data-share-done]").click();
  await share.waitFor({ state: "hidden" });
  assert.equal(requests.reservations.length, 0, "Closing optional sharing must leave the export local");
  await reopenShare();
  await downloadAgain(exported);
  await share.locator("[data-share-file]").click();
  await page.waitForFunction(() => window.exportObservation.files.length === 1);
  const nativeFile = await page.evaluate(() => window.exportObservation.files[0]);
  assert.equal(nativeFile.name, download.suggestedFilename());
  assert.deepEqual(Buffer.from(nativeFile.bytes), exported, "Native sharing must receive the original exported File");
  assert.equal(await share.getByRole("alert").count(), 0, "Dismissing native sharing is not an error");

  await share.locator("[data-share-done]").click();
  await exportDialog.getByRole("button", { name: "Close export" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const addText = page.getByRole("dialog", { name: "Add text", exact: true });
  await addText.getByRole("textbox", { name: "Text content" }).fill("An edit made after export");
  await addText.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".textOverlay").waitFor();
  await reopenShare();
  await downloadAgain(exported);
  await share.getByLabel("Video title", { exact: true }).fill("Acceptance video");

  assert.equal(await share.getByText(/Your account can manage and delete this link/).count(), 1);
  statusMode = "hold";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("progressbar", { name: "Preparing online sharing" }).waitFor();
  await share.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("[data-create-publication]")?.disabled);
  releaseStatus();
  assert.equal(requests.reservations.length, 0, "Cancelling preparation must not reserve or upload a file");
  assert.equal(await share.getByRole("alert").count(), 0);
  statusMode = "fail";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("alert").waitFor();
  assert.equal(requests.reservations.length, 0, "Failed account status check must leave the export local");
  await downloadAgain(exported);
  statusMode = "ready";
  reserveMode = "expired";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("alert").waitFor();
  assert.match(await share.getByRole("alert").innerText(), /no longer available/);
  assert.equal(requests.reservations.length, 1, "An expired reservation must wait for an explicit retry");
  assert.equal(requests.uploads.length, 0);
  assert.equal(await share.getByLabel("Video title", { exact: true }).inputValue(), "Acceptance video");
  await downloadAgain(exported);
  reserveMode = "ready";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("alert").waitFor();
  assert.match(await share.getByRole("alert").innerText(), /Link sharing failed/);
  await downloadAgain(exported);
  assert.equal(requests.uploads.length, 1);
  assert.deepEqual(requests.uploads[0].bytes, exported, "Uploading after edits must still send the completed export");
  assert.equal(requests.uploads[0].type, nativeFile.type);

  uploadMode = "expired";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("alert").waitFor();
  assert.match(await share.getByRole("alert").innerText(), /Sign in to manage or create links/);
  assert.equal(await share.getByText("Shared videos", { exact: true }).count(), 0);
  await downloadAgain(exported);

  uploadMode = "hold";
  await share.locator("[data-create-publication]").click();
  await share.getByRole("progressbar", { name: "Uploading exported file" }).waitFor();
  await share.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("[data-create-publication]")?.disabled);
  releaseUpload();
  assert.equal(await share.getByLabel("Published video link").count(), 0, "An aborted upload must not publish a late success into the UI");
  assert.equal(await share.getByRole("alert").count(), 0);
  await downloadAgain(exported);

  uploadMode = "ready";
  await share.locator("[data-create-publication]").click();
  await share.getByLabel("Published video link").waitFor();
  assert.equal(await share.getByLabel("Published video link").inputValue(), publication.url);
  assert.equal(await share.getByRole("link", { name: "Open video", exact: true }).getAttribute("href"), publication.url);
  await share.locator("[data-copy-publication]").click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), publication.url);
  await share.getByRole("button", { name: "Share link", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.exportObservation.links), [publication.url]);
  assert.equal(await page.evaluate(() => window.exportObservation.renders), 1, "Retrying, sharing, and later edits must not trigger a second render");
  assert(requests.statusChecks >= 8, "Each explicit link attempt must recheck sharing status");
  assert.equal(context.pages().length, 1, "An existing account session must not open a sign-in popup");
  assert.equal(requests.reservations.length, 5);
  assert.notEqual(requests.reservations[0].idempotencyKey, requests.reservations[1].idempotencyKey, "Expired reservations must get a fresh identity on explicit retry");
  assert.equal(new Set(requests.reservations.slice(1).map(item => item.idempotencyKey)).size, 1, "Other upload retries must reuse the export identity");
  for (const input of requests.reservations) {
    assert.equal(input.title, "Acceptance video");
    assert.equal(input.filename, download.suggestedFilename());
    assert.equal(input.size, exported.length);
    assert.equal(input.format, "video");
  }
  for (const upload of requests.uploads) assert.deepEqual(upload.bytes, exported);
  assert.equal(requests.posters.length, 1, "The completed publication must upload its selected cover once");
  assert.equal(requests.posters[0].type, "image/webp");
  assert.equal(requests.posters[0].bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(requests.posters[0].bytes.toString("ascii", 8, 12), "WEBP");
  assert(await share.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Sharing controls must fit the phone viewport");
  await page.screenshot({ path: join(screenshots, "share-ready-mobile.png"), fullPage: true });
  await share.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(screenshots, "share-file-mobile.png"), fullPage: true });

  await share.locator("[data-share-done]").click();
  assert(await exportDialog.getByRole("button", { name: /Export again/ }).isEnabled(), "A completed result must still allow exporting later edits explicitly");
  await page.locator("[data-export-share]:visible").click();
  await share.getByLabel("Published video link").waitFor();
  assert.equal(requests.uploads.length, 4, "Reopening a published export must not upload it again");
  assert.equal(requests.posters.length, 1, "Reopening a published export must not upload its cover again");
  available = false;
  await share.locator("[data-share-done]").click();
  await exportDialog.getByRole("button", { name: "Close export" }).click();
  await page.evaluate(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
  await openExport();
  await page.locator("[data-export-share]:visible").click();
  await share.getByText("Link sharing isn’t available yet.", { exact: true }).waitFor();
  assert.equal(await share.locator("[data-share-file]").count(), 0, "Unsupported file sharing must not be offered");
  await downloadAgain(exported);

  available = true;
  await share.locator("[data-share-done]").click();
  await page.locator("[data-export-share]:visible").click();
  await share.getByLabel("Published video link").waitFor();
  await share.locator("details > summary").click();
  await share.getByText("Acceptance video", { exact: true }).waitFor();

  // Sign out in another tab so the ready Share panel stays mounted while its session changes.
  const accountTab = await context.newPage();
  try {
    await accountTab.route(`${origin}/api/**`, handleApi);
    await accountTab.setViewportSize({ width: 1280, height: 800 });
    await accountTab.goto(editorUrl, { waitUntil: "networkidle" });
    const visitAccount = accountTab.getByRole("button", { name: "Visit Site", exact: true });
    if (await visitAccount.isVisible()) await visitAccount.click();
    const accountButton = accountTab.getByRole("button", { name: "Account", exact: true });
    if (!await accountButton.isVisible())
      throw new Error(`Account tab did not show the signed-in account: ${(await accountTab.locator("body").innerText()).slice(0, 1000)}`);
    await accountButton.click();
    const accountDialog = accountTab.getByRole("dialog", { name: "Your account" });
    await accountDialog.getByRole("button", { name: "Sign out" }).click();
    await accountTab.getByRole("dialog", { name: "Sign in to Restyle" }).waitFor();
  } finally {
    await accountTab.close();
  }
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await share.getByLabel("Published video link").waitFor({ state: "detached" });
  assert.equal(await share.locator("details > summary").count(), 0,
    "Signing out must hide account-owned shared videos from the mounted Share panel");
  assert.equal(await share.getByText("Acceptance video", { exact: true }).count(), 0);
  assert.equal(await share.locator("[data-download-again]").count(), 1,
    "Signing out must retain the completed local export in the Share panel");
  assert.equal(await share.getByText(download.suggestedFilename(), { exact: true }).count(), 1);
  assert.equal(await exportDialog.getAttribute("data-state"), "done");
  assert.deepEqual(errors, []);
  console.log(`Export/share passed: account-gated render/download, exact File and upload bytes, no automatic upload, retained result after edits/failure/cancel and sign-out, status cancellation/recovery, idempotent retries, canonical link. Screenshot: ${join(screenshots, "share-ready-mobile.png")}`);
} catch (error) {
  await page.screenshot({ path: join(screenshots, "failure.png"), fullPage: true }).catch(() => {});
  console.error(`Export/share UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1600)}\nScreenshots: ${screenshots}`);
  throw error;
} finally {
  releaseUpload?.();
  releaseStatus?.();
  await browser.close();
}
