import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const fixture = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const videoBytes = await readFile(fixture);
const origin = new URL(editorUrl).origin;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});

async function openProject(page) {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole("button", { name: /^(Open editor|Start editing)$/ }).click();
  await page.locator("[data-desktop-editor], .editorWorkspace").first().waitFor();
}

function fakeRenderService(page) {
  const jobs = new Map();
  const requests = { creates: [], uploads: 0, deletes: 0, results: 0 };
  page.route(`${origin}/api/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/session" && request.method() === "GET")
      return json({ available: true, clerkAvailable: false, clerkPublishableKey: null, canLinkEmail: false, emailLinked: false, user: { id: "export-tester", name: "Export tester" } });
    if (path === "/api/renders" && request.method() === "GET")
      return json({ available: true, maxSourceBytes: 512 * 1024 * 1024, maxSources: 16,
        formats: ["video"], qualities: ["720p", "1080p", "4K"] });
    if (path === "/api/publishing" && request.method() === "GET")
      return json({ available: false, hasSession: false, maxBytes: 50 * 1024 * 1024 });
    if (path === "/api/renders" && request.method() === "POST") {
      const id = `job_${jobs.size + 1}`;
      requests.creates.push(request.postDataJSON());
      jobs.set(id, { ready: false, polls: 0 });
      return json({ id, status: "uploading", progress: 0 }, 201);
    }
    const match = /^\/api\/renders\/(job_\d+)(?:\/(sources\/[^/]+|start|result))?$/.exec(path);
    const job = match && jobs.get(match[1]);
    if (!job) throw new Error(`Unexpected export request ${request.method()} ${path}`);
    if (match[2]?.startsWith("sources/") && request.method() === "PUT") {
      requests.uploads++;
      return json({ uploaded: true });
    }
    if (match[2] === "start" && request.method() === "POST") return json({ id: match[1], status: "queued", progress: 0 }, 202);
    if (!match[2] && request.method() === "GET") {
      job.polls++;
      return json({ id: match[1], status: job.ready ? "ready" : "rendering",
        progress: job.ready ? 1 : Math.min(.8, .1 + job.polls * .08) });
    }
    if (match[2] === "result" && request.method() === "GET") {
      requests.results++;
      return route.fulfill({ status: 200, contentType: "video/mp4", body: videoBytes });
    }
    if (!match[2] && request.method() === "DELETE") {
      requests.deletes++;
      return json({ cancelled: true });
    }
    throw new Error(`Unexpected export request ${request.method()} ${path}`);
  });
  return { jobs, requests, releaseLatest() { jobs.get(`job_${jobs.size}`).ready = true; } };
}

async function checkLayout(dialog, phone) {
  assert.equal(await dialog.evaluate(element => element.open && element.matches(":modal")), true);
  const box = await dialog.boundingBox();
  assert(box);
  assert(Math.abs(box.width - (phone ? 342 : 1120)) < 3, `Unexpected ${phone ? "phone" : "desktop"} dialog width ${box.width}`);
  const preview = dialog.locator("[data-export-preview]");
  const picture = preview.locator(":scope > div").first();
  const pictureBox = await picture.boundingBox();
  assert(pictureBox);
  assert(Math.abs(pictureBox.height / pictureBox.width - 16 / 9) < .03, "Preview must show the project's real portrait aspect");
  if (phone) {
    assert(Math.abs(pictureBox.width - 132) < 3, "Phone preview should use the 132px split-row frame");
    const clock = preview.locator(":scope > div:nth-child(2) > span").first();
    assert.equal(await clock.evaluate(element => getComputedStyle(element).display), "none", "Phone transport hides the time readout");
  } else {
    assert(pictureBox.width > 250, "Desktop preview should occupy the left well");
    assert(await preview.locator('button[aria-label="Mute preview"]').last().isVisible());
  }
}

async function scrub(slider) {
  const box = await slider.boundingBox();
  assert(box);
  await slider.click({ position: { x: box.width * .58, y: box.height / 2 } });
  assert(Number(await slider.inputValue()) > 2, "Scrubbing should move the preview beyond its opening frame");
}

async function exercise(phone) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: phone, hasTouch: phone, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const service = fakeRenderService(page);
  try {
    await openProject(page);
    if (phone) {
      await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: "Flat video", exact: true }).click();
    } else await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.locator("dialog[data-state]");
    await dialog.waitFor();
    await checkLayout(dialog, phone);
    const sourceVideo = dialog.locator("[data-export-preview] video").first();
    await page.waitForFunction(() => document.querySelector('[data-export-preview] video')?.readyState >= 2);
    const originalSource = await sourceVideo.getAttribute("src");
    assert(originalSource, "The export preview should load the source clip");
    if (phone) {
      const format = dialog.getByRole("combobox", { name: "Export format" });
      await format.selectOption("pvo");
      assert.equal(await format.inputValue(), "pvo");
      await format.selectOption("video");
    } else {
      const formats = dialog.getByRole("radiogroup", { name: "Export format" });
      await formats.getByRole("radio", { name: /Interactive/ }).click();
      assert.equal(await formats.getByRole("radio", { name: /Interactive/ }).getAttribute("aria-checked"), "true");
      await formats.getByRole("radio", { name: /Video/ }).click();
    }
    const quality = dialog.getByRole("radiogroup", { name: "Export quality" });
    await quality.getByRole("radio", { name: /^4K/ }).click();
    assert.equal(await quality.getByRole("radio", { name: /^4K/ }).getAttribute("aria-checked"), "true");
    await quality.getByRole("radio", { name: /^720p/ }).click();
    await dialog.getByRole("button", { name: phone ? /Change cover/ : /Choose thumbnail/ }).click();
    await page.locator('dialog[data-state="picker"]').waitFor();
    const coverSlider = dialog.getByRole("slider", { name: "Pick a cover frame" });
    await scrub(coverSlider);
    await dialog.getByRole("button", { name: "Use this frame" }).click();
    await page.locator('dialog[data-state="setup"]').waitFor();
    if (phone) {
      await dialog.getByRole("button", { name: /Change cover/ }).click();
      await page.locator('dialog[data-state="picker"]').waitFor();
      assert(Number(await dialog.getByRole("slider", { name: "Pick a cover frame" }).inputValue()) > 2,
        "The phone cover picker should reopen at the saved frame");
      await dialog.getByRole("button", { name: "Close cover picker" }).click();
      await page.locator('dialog[data-state="setup"]').waitFor();
    } else assert.match(await dialog.innerText(), /Cover 0:0[1-7]/, "Selected cover should be retained in settings");

    const firstProgress = dialog.getByRole("progressbar", { name: "Export progress" });
    await dialog.getByRole("button", { name: /Export video/ }).click();
    await page.locator('dialog[data-state="exporting"]').waitFor();
    await firstProgress.waitFor();
    await dialog.locator('[data-export-preview] button[aria-label="Unmute preview"]').nth(phone ? 0 : 1).waitFor();
    await dialog.getByRole("button", { name: "Play export preview" }).click();
    await dialog.getByRole("button", { name: "Pause export preview" }).waitFor();
    await scrub(dialog.getByRole("slider", { name: "Scrub export preview" }));
    await dialog.getByRole("button", { name: "Pause export preview" }).click();
    const heldProgress = Number(await firstProgress.getAttribute("aria-valuenow"));
    await page.waitForFunction(previous => Number(document.querySelector('[aria-label="Export progress"]')?.getAttribute("aria-valuenow")) > previous,
      heldProgress, { timeout: 7000 });
    await dialog.getByRole("button", { name: "Play export preview" }).click();
    await dialog.getByRole("button", { name: "Cancel export" }).click();
    await page.locator('dialog[data-state="setup"]').waitFor();
    assert(await dialog.getByRole("button", { name: "Pause export preview" }).isVisible(), "Cancelling should not stop preview playback");
    assert.equal(service.requests.deletes, 1, "Cancellation should clean its private render job");

    await dialog.getByRole("button", { name: /Export video/ }).click();
    await page.locator('dialog[data-state="exporting"]').waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Export progress"]')?.getAttribute("aria-valuenow") !== "0");
    service.releaseLatest();
    await page.locator('dialog[data-state="done"]').waitFor({ timeout: 30000 });
    await dialog.getByText("✓ EXPORTED FILE", { exact: true }).waitFor();
    const resultVideo = dialog.locator('[data-export-preview] video[data-visible="true"]');
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-export-preview] video[data-visible="true"]');
      return video?.readyState >= 2;
    });
    assert(await resultVideo.evaluate(video => video.videoWidth > 0), "Ready preview should decode the completed file");
    await dialog.getByRole("button", { name: "Play export preview" }).click();
    await page.waitForFunction(() => document.querySelector('[data-export-preview] video[data-visible="true"]')?.currentTime > .1);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: /Download/ }).click(),
    ]);
    assert.equal(await download.failure(), null);
    assert.deepEqual(await readFile(await download.path()), videoBytes, "Download must use the completed artifact bytes");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    const share = dialog.getByRole("dialog", { name: "Share export" });
    await share.waitFor();
    assert.equal(await dialog.getAttribute("data-state"), "done", "Share must leave the ready result mounted");
    assert(await resultVideo.isVisible());
    await share.getByRole("button", { name: "Done", exact: true }).click();
    await share.waitFor({ state: "hidden" });
    assert.equal(await dialog.getAttribute("data-state"), "done");
    await dialog.getByRole("button", { name: /Export again/ }).click();
    await page.locator('dialog[data-state="setup"]').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-export-preview] video')?.readyState >= 2);
    assert.equal(await sourceVideo.getAttribute("src"), originalSource,
      "Export again should restore the original source clip");
    assert(await sourceVideo.isVisible(), "The restored source clip should be visible");
    assert.equal(await dialog.locator('[data-export-preview] video[data-visible="true"]').count(), 0,
      "Export again should remove the completed result video");
    assert.equal(service.requests.creates.length, 2);
    assert.equal(service.requests.results, 1);
    assert.equal(service.requests.uploads, 2);
    assert.deepEqual(errors, []);
    console.log(`${phone ? "Phone" : "Desktop"} export dialog passed: picker, preview during render, cancellation, ready playback, download, share overlay and Export again.`);
  } catch (error) {
    console.error(`${phone ? "Phone" : "Desktop"} export dialog: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1500)}`);
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await exercise(false);
  await exercise(true);
} finally {
  await browser.close();
}
