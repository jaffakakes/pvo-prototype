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
await page.route("**/api/auth/session", route => route.fulfill({ contentType: "application/json",
  body: JSON.stringify({ available: true, clerkAvailable: false, clerkPublishableKey: null,
    canLinkEmail: false, emailLinked: false, user: { id: "components-extra-check", name: "Components extra check" } }) }));
await page.route("**/api/renders", route => route.fulfill({ contentType: "application/json",
  body: JSON.stringify({ available: false, maxSourceBytes: 0, maxSources: 0, formats: [] }) }));

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
  await page.locator(".componentTypeTile").filter({ hasText: "Show a message" }).click();
  let dialog = page.getByRole("dialog", { name: "Message" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Learn about this look");
  await dialog.getByRole("textbox", { name: "Text" }).fill("A short interactive card");
  await dialog.getByRole("textbox", { name: "Button 1" }).fill("Skip ahead");
  await dialog.getByRole("button", { name: "Done" }).click();
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

  // Route the Message button to the current playhead.
  await scrubBy(-50);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Message" });
  await dialog.getByRole("tab", { name: "Action" }).click();
  await dialog.getByRole("button", { name: /When viewers tap “Skip ahead”/ }).click();
  await dialog.getByRole("group", { name: "Viewer action" })
    .getByRole("button", { name: /Jump to a point/ }).first().click();
  assert.match(await dialog.getByRole("button", { name: /When viewers tap “Skip ahead”/ }).innerText(),
    /Jump to a point/, "Message button should route to a point in this scene");
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Try", exact: true }).click();
  const messageButton = page.locator(".compCardButtons").getByRole("button", { name: "Skip ahead" });
  await messageButton.waitFor({ state: "visible", timeout: 5000 });
  await messageButton.click();
  await page.waitForFunction(() => /^0:0[1-9]/.test(document.querySelector(".transportTime")?.textContent ?? ""));
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();

  // Add a pausing Form as a second interactive layer.
  await scrubBy(-25);
  await page.keyboard.press("c");
  await page.locator(".componentTypeTile").filter({ hasText: "Ask for details" }).click();
  dialog = page.getByRole("dialog", { name: "Form" });
  await dialog.getByRole("textbox", { name: "Heading" }).fill("Tell us more");
  await dialog.getByRole("textbox", { name: "Submit button" }).fill("Send answer");
  await dialog.getByRole("textbox", { name: "Field 1 name" }).fill("Name");
  await dialog.getByRole("tab", { name: "Action" }).click();
  const pause = dialog.getByRole("switch", { name: "Pause if nobody responds" });
  if (await pause.getAttribute("aria-checked") !== "true") await pause.click();
  assert.equal(await pause.getAttribute("aria-checked"), "true", "The Form must wait for a response");
  await dialog.getByRole("button", { name: "Done" }).click();
  assert.equal(await page.locator(".compBar").count(), 2, "Both interactive layers should have timeline bars");

  // In viewer preview, the Form holds until submitted.
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector(".compForm")
    && !!document.querySelector(".playBtn:disabled"), null, { timeout: 15000 });
  const heldTime = await page.locator(".transportTime").innerText();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".transportTime").innerText(), heldTime,
    "The Form must pause viewer playback until submitted");
  await page.locator(".compForm").getByLabel("Name", { exact: true }).fill("Ada");
  await page.locator(".compForm").getByRole("button", { name: "Send answer" }).click();
  await page.waitForFunction(() => !document.querySelector(".playBtn:disabled"), null, { timeout: 5000 });
  if (await page.getByRole("button", { name: "Stop trying", exact: true }).count())
    await page.getByRole("button", { name: "Stop trying", exact: true }).click();

  // Interactive components are packaged in the single PVO export.
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Export and create link" }).click();
  const exportDialog = page.locator("dialog[data-state]");
  assert.equal(await exportDialog.getByRole("combobox", { name: "Export format" }).count(), 0);
  await exportDialog.getByRole("button", { name: /Export and share/ }).click();
  await page.locator('dialog[data-state="done"]').waitFor({ timeout: 60000 });
  const share = page.getByRole("dialog", { name: "Share export", exact: true });
  await share.waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    share.locator("[data-download-again]").click(),
  ]);
  assert.match(download.suggestedFilename(), /\.pvo$/, "Interactive export has the wrong filename");
  const bytes = await readFile(await download.path());
  assert(bytes.length > 1024, "Flat export is unexpectedly empty");
  assert.equal(bytes.subarray(0, 8).toString(), "PVOPACK1", "Export must be a PVO container");
  assert.deepEqual(pageErrors, [], "Uncaught browser errors occurred");
  console.log(JSON.stringify({ card: "fields, move, trim, undo, redo, jump", form: "fields, pause, submit", export: download.suggestedFilename() }, null, 2));
} finally {
  await browser.close();
}
