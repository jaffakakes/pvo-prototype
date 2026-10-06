import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const origin = new URL(editorUrl).origin;
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ["camera", "microphone"], acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
const uploads = [];
const reservations = [];
let posters = 0;
let downloads = 0;
let failUpload = true;
page.on("pageerror", error => errors.push(error.message));
page.on("download", () => downloads++);
const publication = { id: "acceptance_pvo_1", url: `${origin}/player/acceptance_pvo_1`, status: "pending" };
await page.route(`${origin}/api/**`, route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const respond = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/api/auth/session")
    return respond({ available: true, clerkAvailable: false, clerkPublishableKey: null,
      canLinkEmail: false, emailLinked: false, user: { id: "acceptance-account", name: "Acceptance creator" } });
  if (path === "/api/renders") return respond({ available: false, maxSourceBytes: 0, maxSources: 0, formats: [] });
  if (path === "/api/publishing") return respond({ available: true, hasSession: true, maxBytes: 671088640000 });
  if (path === "/api/publications" && request.method() === "GET")
    return respond({ publications: [] });
  if (path === "/api/publications" && request.method() === "POST") {
    reservations.push(request.postDataJSON());
    return respond(publication, 201);
  }
  if (path === `/api/publications/${publication.id}/content` && request.method() === "PUT") {
    uploads.push(request.postDataBuffer());
    if (failUpload) return respond({ error: "Temporary upload failure" }, 500);
    return respond({ ...publication, status: "ready" });
  }
  if (path === `/api/publications/${publication.id}/poster` && request.method() === "PUT") {
    posters++;
    return respond({ uploaded: true });
  }
  throw new Error(`Unexpected API operation: ${request.method()} ${path}`);
});

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await page.locator(".editorWorkspace").waitFor();
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Export and create link", exact: true }).click();
  const exportDialog = page.locator("dialog[data-state]");
  await exportDialog.waitFor();
  assert.equal(await exportDialog.getByRole("radiogroup", { name: "Export format" }).count(), 0,
    "Flat video export must not be offered");
  await exportDialog.getByRole("radiogroup", { name: "Export quality" }).getByRole("radio", { name: /^720p/ }).click();
  await exportDialog.getByRole("button", { name: /Export and share/ }).click();
  const share = page.getByRole("dialog", { name: "Share export", exact: true });
  await share.waitFor({ timeout: 60000 });
  await share.getByRole("alert").waitFor({ timeout: 60000 });
  assert.match(await share.getByRole("alert").innerText(), /Link sharing failed/);
  assert.equal(downloads, 0, "Export must not download a file automatically");
  assert.equal(reservations.length, 1, "Export must create a publication without another tap");
  assert.equal(reservations[0].format, "pvo");
  assert.equal(uploads.length, 1);
  assert.equal(await share.getByLabel("Published PVO link").count(), 0);

  failUpload = false;
  await share.locator("[data-create-publication]").click();
  await share.getByLabel("Published PVO link").waitFor();
  assert.equal(await share.getByLabel("Published PVO link").inputValue(), publication.url);
  assert.equal(reservations.length, 2, "Retry must reuse the prepared publication");
  assert.equal(reservations[0].idempotencyKey, reservations[1].idempotencyKey);
  assert.deepEqual(uploads[0], uploads[1], "Retry must upload the same completed PVO");
  assert.equal(posters, 1);
  assert.equal(await share.getByRole("link", { name: "Open PVO" }).getAttribute("href"), publication.url);
  const pendingDownload = page.waitForEvent("download");
  await share.locator("[data-download-again]").click();
  const download = await pendingDownload;
  assert.match(download.suggestedFilename(), /\.pvo$/);
  assert.deepEqual(await readFile(await download.path()), uploads[1], "Optional download must match the shared PVO");
  assert.deepEqual(errors, []);
  console.log("Export/share passed: PVO-only export, automatic link attempt, explicit retry, exact bytes, optional download.");
} finally {
  await browser.close();
}
