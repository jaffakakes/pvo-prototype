import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

async function addComponent(type) {
  const collapse = page.getByRole("button", { name: "Collapse component tools" });
  if (await collapse.isVisible()) await collapse.click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: type }).click();
  await page.getByRole("dialog", { name: type }).waitFor();
  await page.getByRole("button", { name: "Close" }).click();
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording" }).waitFor();
  await page.waitForTimeout(3300);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByRole("button", { name: "Open editor" }).click();

  await addComponent("Tooltip");
  assert.ok(await page.locator(".compBar").evaluate(el => el.getBoundingClientRect().top < document.querySelector(".tlClips").getBoundingClientRect().top), "Components start above the video track");
  await addComponent("Card");
  await addComponent("Choice");

  const layers = page.locator(".compBar, .compMarker");
  assert.equal(await layers.count(), 3, "Each new component must have a timeline item");
  assert.deepEqual(await layers.evaluateAll(items => items.map(item => item.dataset.layer)), ["2", "1", "0"]);
  const boxes = await Promise.all([0, 1, 2].map(index => layers.nth(index).boundingBox()));
  assert.ok(boxes.every(Boolean));
  for (let index = 1; index < boxes.length; index++) {
    assert.ok(boxes[index].y + boxes[index].height + 6 <= boxes[index - 1].y, "New component layers must appear above older layers without overlap");
  }
  assert.equal(await page.locator(".timelineContent").evaluate(el => Math.round(el.getBoundingClientRect().height)), 236,
    "The timeline content must grow one row for each component and scroll when needed");
  if (process.env.CAPTURE_SHOTS) await page.screenshot({ path: process.env.CAPTURE_SHOTS });
  await page.setViewportSize({ width: 320, height: 700 });
  const compactPreview = await page.locator(".pvBox").boundingBox();
  assert.ok(compactPreview && compactPreview.height >= 100, "Three layers should leave a usable preview on a small phone");
  await page.setViewportSize({ width: 430, height: 932 });

  // Scrub while a component is selected, then reopen it. Selecting the layer must
  // not jump the playhead back to the component's old start time.
  const timeline = await page.locator(".tl").boundingBox();
  assert.ok(timeline);
  await page.mouse.move(timeline.x + 280, timeline.y + 16);
  await page.mouse.down();
  await page.mouse.move(timeline.x + 185, timeline.y + 16, { steps: 8 });
  await page.mouse.up();
  const playheadTime = await page.locator(".transportTime").textContent();
  assert.match(playheadTime, /0:01/, "The timeline should scrub beyond one second");

  await layers.nth(0).click({ position: { x: 10, y: 13 } });
  assert.match(await page.locator(".transportTime").textContent(), /0:01/,
    "Selecting a component must preserve the scrubbed playhead");
  await layers.nth(0).click({ position: { x: 10, y: 13 } });
  const tooltip = page.getByRole("dialog", { name: "Tooltip" });
  await tooltip.waitFor();
  assert.equal((await tooltip.locator(".componentTiming strong").textContent())?.trim(), "0:00");
  await tooltip.getByRole("button", { name: "Use playhead" }).click();
  await tooltip.waitFor({ state: "hidden" });
  assert.ok(await page.locator(".playhead").isVisible(), "Playhead must be visible in the time chooser");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await tooltip.waitFor({ state: "visible" });
  assert.equal((await tooltip.locator(".componentTiming strong").textContent())?.trim(), "0:01",
    "Use playhead must update the component start time");
  await tooltip.getByRole("button", { name: "Close" }).click();

  // The same retained playhead must be available while configuring a Choice outcome.
  await layers.nth(2).click({ position: { x: 10, y: 13 } });
  await layers.nth(2).click({ position: { x: 10, y: 13 } });
  const choice = page.getByRole("dialog", { name: "Choice" });
  await choice.locator(".componentOptionRow").first().locator(".componentOutcome").click();
  const outcome = page.getByRole("dialog", { name: /where\?/ });
  await outcome.getByRole("button", { name: "Use playhead" }).click();
  await outcome.waitFor({ state: "hidden" });
  assert.ok(await page.locator(".playhead").isVisible(), "Playhead must be visible when choosing an outcome time");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await outcome.waitFor({ state: "visible" });
  assert.match(await outcome.locator(".outcomeRow[data-on='true']").innerText(), /Skip to 0:01/,
    "Outcome Use playhead must save the scrubbed position");
  assert.deepEqual(errors, [], "The editor should have no page errors");
  console.log("Component layers and Use playhead browser regression passed.");
} catch (error) {
  console.error(`Component layers regression failed: ${error.message}`);
  console.error(`Page errors: ${errors.join("; ") || "none"}`);
  console.error(`Visible UI: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 1000)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
