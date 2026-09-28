import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const url = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true, permissions: [] });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));

async function drag(locator, dx) {
  const box = await locator.boundingBox();
  assert(box, "Drag target is not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function scrubBy(dx) {
  const box = await page.locator(".tl").boundingBox();
  assert(box, "Timeline is not visible");
  const x = box.x + 211;
  const y = box.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function barWidth() {
  return page.locator(".compBar").first().evaluate(element => Number.parseFloat(element.style.width));
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForTimeout(3400);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("heading", { name: "Edit" }).waitFor();

  // Card fields, plus a timeline move and trim, are real project edits.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Card" }).click();
  let dialog = page.getByRole("dialog", { name: "Card" });
  await dialog.locator(".componentInput").first().fill("Learn about this look");
  await dialog.locator(".componentTextArea").fill("A short interactive card");
  await dialog.getByRole("button", { name: "Add button" }).click();
  await dialog.locator(".componentOptionRow .componentInput").fill("Skip ahead");
  await dialog.getByRole("button", { name: "Close" }).click();
  const bar = page.locator(".compBar").first();
  await bar.waitFor();
  const leftBefore = await bar.evaluate(element => Number.parseFloat(element.style.left));
  await drag(bar, 18);
  const leftAfter = await bar.evaluate(element => Number.parseFloat(element.style.left));
  assert(leftAfter > leftBefore + 8, `Card did not move on the timeline: ${leftBefore} → ${leftAfter}`);
  const widthBefore = await barWidth();
  await drag(bar.locator('.compHandle[data-side="r"]'), -18);
  const widthAfter = await barWidth();
  assert(widthAfter < widthBefore - 8, `Card did not trim: ${widthBefore} → ${widthAfter}`);
  await page.keyboard.press("Control+z");
  const widthUndone = await barWidth();
  assert(widthUndone > widthAfter + 8, "Undo did not restore the card duration");
  await page.keyboard.press("Control+Shift+z");
  const widthRedone = await barWidth();
  assert(Math.abs(widthRedone - widthAfter) < 2, "Redo did not restore the card trim");

  // Set the Card button to jump to the current playhead, then add a hold Form.
  await scrubBy(-50);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Card" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Jump to time/ }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  assert.match(await dialog.locator(".componentOutcome").innerText(), /0:01/, "Card outcome did not store the playhead time");
  await dialog.getByRole("button", { name: "Close" }).click();

  await scrubBy(-25);
  await page.keyboard.press("c");
  await page.locator(".componentTypeTile").filter({ hasText: "Form" }).click();
  dialog = page.getByRole("dialog", { name: "Form" });
  await dialog.locator(".componentInput").fill("Send answer");
  await dialog.getByRole("button", { name: "Phone" }).click();
  assert.equal(await dialog.getByRole("button", { name: "Phone" }).getAttribute("data-on"), "true", "Form field selection did not update");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("dialog", { name: /where\?/ }).getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("dialog", { name: "Form" }).getByRole("button", { name: "Close" }).click();

  // Viewer preview: the Card routes to 0:01; the Form holds until submitted.
  await scrubBy(80);
  await page.getByRole("button", { name: "Try viewer preview" }).click();
  await page.locator(".compCardButtons button").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".compCardButtons button").click();
  await page.locator(".holdTag").waitFor({ state: "visible", timeout: 5000 });
  assert.match(await page.locator(".transportTime").innerText(), /HOLD/, "Form did not pause viewer playback");
  await page.getByRole("textbox", { name: "Name" }).fill("Ada");
  await page.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await page.getByRole("textbox", { name: "Phone" }).fill("5551234");
  await page.locator(".compForm").getByRole("button", { name: "Send answer" }).click();
  await page.locator(".holdTag").waitFor({ state: "hidden", timeout: 5000 });
  if (await page.getByRole("button", { name: "Stop viewer preview" }).count()) {
    await page.getByRole("button", { name: "Stop viewer preview" }).click();
  }

  // Flat export must remain a playable video, not a PVO package or an overlay burn-in.
  await page.getByRole("button", { name: "Next" }).click();
  assert.equal(await page.locator(".formatGrid button").count(), 2, "Export format switch is missing with components");
  await page.locator(".formatGrid button").first().click();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: "Export video" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^restyle-video\.(webm|mp4)$/, "Flat export has the wrong filename");
  const bytes = await readFile(await download.path());
  assert(bytes.length > 1024, "Flat export is unexpectedly empty");
  assert.notEqual(bytes.subarray(0, 8).toString(), "PVOPACK1", "Flat export is a PVO container");
  const sample = await page.getByRole("link", { name: "Download" }).evaluate(async link => {
    const video = document.createElement("video");
    video.muted = true;
    video.src = link.href;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
    video.currentTime = Math.min(.7, Math.max(.1, video.duration / 3));
    await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const [r, g, b] = ctx.getImageData(Math.round(canvas.width * .15), Math.round(canvas.height * .2), 1, 1).data;
    return { width: canvas.width, height: canvas.height, luminance: (r + g + b) / 3 };
  });
  assert(sample.width > 0 && sample.height > 0, "Flat export is not decodable video");
  assert(sample.luminance > 65, `Card appears to have been burned into the flat video: ${JSON.stringify(sample)}`);
  assert.deepEqual(pageErrors, [], "Uncaught browser errors occurred");
  console.log(JSON.stringify({ card: "fields, move, trim, undo, redo, jump", form: "fields, continue, hold, submit", export: download.suggestedFilename(), sample }, null, 2));
} finally {
  await browser.close();
}
