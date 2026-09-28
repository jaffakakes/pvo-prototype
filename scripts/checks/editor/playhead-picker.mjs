import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: [] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function scrubBy(dx) {
  const box = await page.locator(".tl").boundingBox();
  assert(box, "Timeline must be visible during playhead selection");
  const x = box.x + 270;
  const y = box.y + 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function assertPickerOpen(previousDialog) {
  await previousDialog.waitFor({ state: "hidden" });
  const bar = page.locator('.toolBar[data-time-pick="true"]');
  await bar.waitFor({ state: "visible" });
  await bar.getByRole("button", { name: "Accept", exact: true }).waitFor({ state: "visible" });
  await bar.getByRole("button", { name: "Cancel", exact: true }).waitFor({ state: "visible" });
  await page.locator(".editorWorkspace").evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  assert.equal(await page.locator(".playheadPickBanner").count(), 0, "The picker must not render a separate popup card");
  assert(await page.locator(".playhead").isVisible(), "The playhead must be visible while choosing a time");
  const layout = await bar.evaluate(element => {
    const app = element.closest(".app")?.getBoundingClientRect();
    const timeline = element.parentElement?.querySelector(".tl")?.getBoundingClientRect();
    const bar = element.getBoundingClientRect();
    const cancel = element.querySelector('button[aria-label="Cancel"]') ?? [...element.querySelectorAll("button")].find(button => button.textContent?.trim() === "Cancel");
    const accept = element.querySelector('button[aria-label="Accept"]') ?? [...element.querySelectorAll("button")].find(button => button.textContent?.trim() === "Accept");
    const cancelBounds = cancel?.getBoundingClientRect();
    const acceptBounds = accept?.getBoundingClientRect();
    const hit = timeline && document.elementFromPoint(timeline.left + Math.min(270, timeline.width - 20), timeline.top + 12);
    return {
      flushWithTimeline: !!timeline && Math.abs(bar.top - timeline.bottom) <= 4,
      reachesAppBottom: !!app && Math.abs(bar.bottom - app.bottom) <= 4,
      timelineAccessible: !!timeline && !!hit && document.querySelector(".tl")?.contains(hit),
      buttonsFit: !!cancelBounds && !!acceptBounds && cancelBounds.width >= 40 && acceptBounds.width >= 40 &&
        cancelBounds.height >= 40 && acceptBounds.height >= 40 && cancelBounds.right <= acceptBounds.left &&
        cancelBounds.left >= bar.left && acceptBounds.right <= bar.right,
    };
  });
  assert(layout.flushWithTimeline, "The time controls should occupy the existing bar directly below the timeline");
  assert(layout.reachesAppBottom, "The time controls should use the bottom bar, not float above it");
  assert(layout.timelineAccessible, "The time controls must not block scrubbing the timeline");
  assert(layout.buttonsFit, "Cancel and Accept must fit inside the bottom bar as usable touch targets");
}

async function beginPicker(dialog) {
  await dialog.getByRole("button", { name: "Use playhead" }).click();
  await assertPickerOpen(dialog);
}

async function cancelPicker(dialog) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "visible" });
}

async function acceptPicker(dialog) {
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await dialog.waitFor({ state: "visible" });
}

async function showTimingTab() {
  const dialog = page.getByRole("dialog", { name: "Edit text" });
  await dialog.waitFor();
  if (!(await dialog.getByRole("tab", { name: "Timing" }).getAttribute("aria-selected"))?.includes("true")) {
    await dialog.getByRole("tab", { name: "Timing" }).click();
  }
  return dialog;
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();

  // Appears at: the component does not move until Accept; Cancel is lossless.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Tooltip" }).click();
  const tooltip = page.getByRole("dialog", { name: "Tooltip" });
  await tooltip.waitFor();
  const originalAt = (await tooltip.locator(".componentTiming strong").textContent())?.trim();
  const tooltipBar = page.locator(".compBar").first();
  const originalLeft = await tooltipBar.evaluate(element => element.style.left);
  await beginPicker(tooltip);
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: process.env.CAPTURE_SHOTS });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(350);
  await assertPickerOpen(tooltip);
  if (process.env.CAPTURE_SHOTS_SMALL) await page.screenshot({ path: process.env.CAPTURE_SHOTS_SMALL });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(350);
  await scrubBy(-60);
  assert.match(await page.locator(".transportTime").innerText(), /0:01/, "Scrubbing should move the draft playhead");
  assert.match(await page.locator(".transportTime").innerText(), /\d+:\d{2}\.\d/, "The visible transport should show the picked time precisely");
  assert.equal(await tooltipBar.evaluate(element => element.style.left), originalLeft, "A draft time must not move the component");
  await cancelPicker(tooltip);
  assert.equal((await tooltip.locator(".componentTiming strong").textContent())?.trim(), originalAt, "Cancel changed component timing");
  assert.match(await page.locator(".transportTime").innerText(), /0:00/, "Cancel should restore the original playhead");
  await beginPicker(tooltip);
  await scrubBy(-60);
  await acceptPicker(tooltip);
  assert.equal((await tooltip.locator(".componentTiming strong").textContent())?.trim(), "0:01", "Accept did not update component timing");
  assert.notEqual(await tooltipBar.evaluate(element => element.style.left), originalLeft, "Accepted timing did not move the component layer");
  await tooltip.getByRole("button", { name: "Close" }).click();

  // Jump to time: cancelling preserves Continue; accepting explicitly sets Jump.
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Choice" }).click();
  const choice = page.getByRole("dialog", { name: "Choice" });
  await choice.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  const outcome = page.getByRole("dialog", { name: /where\?/ });
  await outcome.waitFor();
  assert.equal(await outcome.locator(".outcomeRow[data-on='true']").first().locator("strong").innerText(), "Continue");
  await beginPicker(outcome);
  await scrubBy(-55);
  await cancelPicker(outcome);
  assert.equal(await outcome.locator(".outcomeRow[data-on='true']").first().locator("strong").innerText(), "Continue", "Cancel changed the Choice outcome");
  await beginPicker(outcome);
  await scrubBy(-55);
  await acceptPicker(outcome);
  assert.match(await outcome.locator(".outcomeRow[data-on='true']").innerText(), /Jump to time[\s\S]*0:02/, "Accept did not save the jump time");

  // Nested request success routes should return to the same route after picking.
  await outcome.getByRole("button", { name: /Send request/ }).click();
  await outcome.getByRole("button", { name: /On success/ }).click();
  const success = page.getByRole("dialog", { name: "When it succeeds" });
  await success.waitFor();
  await beginPicker(success);
  await scrubBy(-45);
  await cancelPicker(success);
  assert.equal(await success.locator(".outcomeRow[data-on='true']").first().locator("strong").innerText(), "Continue", "Cancel changed a nested request route");
  await beginPicker(success);
  await scrubBy(-45);
  await acceptPicker(success);
  assert.match(await success.locator(".outcomeRow[data-on='true']").innerText(), /Jump to time/, "Accept did not save the nested request jump");
  await success.getByRole("button", { name: "Close" }).click();

  // Text timing uses the same unobstructed picker and preserves its duration.
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const addText = page.getByRole("dialog", { name: "Add text" });
  await addText.getByRole("textbox", { name: "Text content" }).fill("Playhead check");
  await addText.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  let textDialog = await showTimingTab();
  const textStart = await textDialog.getByRole("spinbutton", { name: "Text start" }).inputValue();
  const textEnd = await textDialog.getByRole("spinbutton", { name: "Text end" }).inputValue();
  const span = Number(textEnd) - Number(textStart);
  await beginPicker(textDialog);
  await scrubBy(70);
  await cancelPicker(textDialog);
  textDialog = await showTimingTab();
  assert.equal(await textDialog.getByRole("spinbutton", { name: "Text start" }).inputValue(), textStart, "Cancel changed text start");
  assert.equal(await textDialog.getByRole("spinbutton", { name: "Text end" }).inputValue(), textEnd, "Cancel changed text end");
  await beginPicker(textDialog);
  await scrubBy(70);
  await acceptPicker(textDialog);
  textDialog = await showTimingTab();
  const acceptedStart = Number(await textDialog.getByRole("spinbutton", { name: "Text start" }).inputValue());
  const acceptedEnd = Number(await textDialog.getByRole("spinbutton", { name: "Text end" }).inputValue());
  assert(acceptedStart < Number(textStart) - .2, "Accept did not move text to the picked time");
  assert(Math.abs((acceptedEnd - acceptedStart) - span) < .12, "Moving text should preserve its duration");

  assert.deepEqual(errors, [], "The editor should have no browser errors");
  console.log("Playhead picker browser regression passed: component, jump, request route, text, Accept and Cancel.");
} catch (error) {
  console.error(`Playhead picker regression failed: ${error.message}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1200)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
