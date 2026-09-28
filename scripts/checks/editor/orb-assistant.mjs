import assert from "node:assert/strict";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installAssistantFixture } from "./assistant-fixture.mjs";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
const provider = await installAssistantFixture(context);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const phase = value => page.locator(`[data-assistant-phase="${value}"]`);
const field = page.getByRole("textbox", { name: "Describe a change" });
const review = page.getByRole("region", { name: "Review assistant change" });
const toolbar = page.locator(".toolBar");
const normalToolButtons = toolbar.locator(".tools button");
const orb = page.locator("[data-assistant-orb]");
const settle = () => page.waitForTimeout(550);

function assertInside(actual, region, message) {
  assert(actual && region && actual.x >= region.x - 1 && actual.y >= region.y - 1
    && actual.x + actual.width <= region.x + region.width + 1
    && actual.y + actual.height <= region.y + region.height + 1,
  `${message}: ${JSON.stringify({ actual, region })}`);
}

async function toolLabels() {
  return normalToolButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label") || button.textContent));
}

async function assertToolbarReplacement(expectedBounds, typing = false) {
  const bounds = await toolbar.boundingBox();
  assert(bounds, "The toolbar must keep its reserved layout region");
  if (expectedBounds) assert.deepEqual(bounds, expectedBounds, "The assistant must preserve toolbar geometry");
  assert.equal(await normalToolButtons.count(), 0,
    "The assistant must unmount normal tool buttons while borrowing the toolbar");
  if (typing) assertInside(await field.boundingBox(), bounds, "The composer must occupy the former toolbar region");
  assert.equal(await page.locator("[data-assistant-dim]").count(), 0,
    "No assistant phase may dim the workspace");
  const dismiss = page.locator("[data-assistant-dismiss-area]");
  if (typing) {
    assert.deepEqual(await dismiss.boundingBox(), await page.locator(".editorWorkspace").boundingBox(),
      "Outside-tap dismissal must cover the full mobile workspace");
    assert.equal(await dismiss.evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)",
      "The empty-toolbar hit area must be transparent");
  }
}

async function workspaceBounds() {
  const result = {};
  for (const selector of [".previewArea", ".transport", ".tl", ".playhead", ".toolBar"])
    result[selector] = await page.locator(selector).boundingBox();
  return result;
}

async function tapEmptyToolbar() {
  const bounds = await toolbar.boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + 4, bounds.y + bounds.height - 4);
}

async function assertComposeContext() {
  const preview = page.locator("[data-assistant-context-preview]");
  const bounds = await preview.boundingBox();
  assert(bounds && bounds.width === 22 && bounds.height === 32,
    "The composer must show a miniature of the selected component");
  assertInside(bounds, await toolbar.boundingBox(), "The component context belongs inside the toolbar");
  assert.match(await page.locator(".orbAssistant").innerText(), /Card.*\d+:\d{2}/s,
    "The composer must identify the selected component and its time");
}

async function assertToolbarRestored(expectedBounds, expectedLabels) {
  await settle();
  assert.deepEqual(await toolbar.boundingBox(), expectedBounds, "Closing the assistant must preserve toolbar geometry");
  assert.deepEqual(await toolLabels(), expectedLabels, "The original component tools must return");
  assert.equal(await toolbar.locator(".tools button:visible").count(), expectedLabels.length);
  assert.equal(await toolbar.evaluate(element => !!element.closest("[inert]")), false,
    "Restored toolbar buttons must be interactive");
  assert.equal(await page.locator("[data-assistant-dim]").count(), 0);
}

async function submit(words) {
  await field.fill(words);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await phase("review").waitFor();
  await settle();
}

async function assertReviewFits() {
  const host = await page.locator("[data-assistant-region]").boundingBox();
  assert(host);
  for (const label of ["Keep", "Hold to view before", "Undo"]) {
    const button = review.getByRole("button", { name: label, exact: true });
    await button.click({ trial: true });
    const bounds = await button.boundingBox();
    assert(bounds && bounds.height >= 42, `${label} must retain a 42px touch target`);
    assert(bounds && bounds.y >= host.y - 1 && bounds.y + bounds.height <= host.y + host.height + 1,
      `${label} must fit the lower region`);
  }
  const orbBounds = await orb.boundingBox();
  const card = await review.boundingBox();
  const toolbarBounds = await toolbar.boundingBox();
  const followUps = page.locator('[aria-label="Try another change"]');
  const chips = await followUps.boundingBox();
  assert(orbBounds && card && toolbarBounds && chips);
  const toolbarCenter = toolbarBounds.x + toolbarBounds.width / 2;
  assert(Math.abs(orbBounds.x + orbBounds.width / 2 - toolbarCenter) <= 1, "The review orb must be centred");
  assert(Math.abs(card.x + card.width / 2 - toolbarCenter) <= 1, "The review card must be centred over the orb");
  assert(card.y + card.height <= orbBounds.y, "The review card must float above the orb without overlap");
  assertInside(card, host, "The complete review card must fit the available region");
  assertInside(chips, toolbarBounds, "Review follow-up chips must fit inside the toolbar");
  assert.equal(await followUps.getByRole("button").count(), 3, "Review must offer all three follow-ups");
  assert(chips.y >= orbBounds.y + orbBounds.height - 1, "Follow-ups must sit below the centred orb");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}

try {
  await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)));
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await phase("idle").waitFor();
  assert.equal(await phase("idle").getAttribute("data-has-target"), "false",
    "An unselected component must leave the orb plain");
  await orb.click();
  const selectNotice = page.locator('[data-notification-id="assistantNoTarget"]');
  await selectNotice.waitFor();
  assert.match(await selectNotice.innerText(), /Select a component first\./);
  assert.equal(await field.count(), 0, "The orb must not open a composer without a selected component");
  await selectNotice.getByRole("button", { name: "Dismiss notification" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Show a message" }).click();
  await page.getByRole("dialog", { name: "Message", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await phase("idle").waitFor();
  await settle();
  assert.equal(await page.locator('[data-notification-id]').count(), 0,
    "Adding and selecting a component must be quiet");
  const geometryBefore = await workspaceBounds();
  const toolbarBefore = await toolbar.boundingBox();
  const idleOrb = await orb.boundingBox();
  assert(toolbarBefore && toolbarBefore.height === 100, "The toolbar must reserve 100px in every assistant phase");
  assert(idleOrb && idleOrb.width === 58 && idleOrb.height === 58, "The orb must have a 58px touch target");
  const toolLabelsBefore = await toolLabels();
  assert(toolLabelsBefore.length > 0, "The selected Card must expose normal editor tools before opening the assistant");
  const transportBefore = await page.locator(".transportTime").innerText();
  await orb.click();
  await field.waitFor();
  await settle();
  assert.deepEqual(await workspaceBounds(), geometryBefore,
    "Opening the assistant must preserve preview, transport, timeline and toolbar geometry");
  await assertToolbarReplacement(toolbarBefore, true);
  await assertComposeContext();
  const composeOrb = await orb.boundingBox();
  assert(composeOrb && Math.abs(composeOrb.x - toolbarBefore.x - 14) <= 1,
    "The compose orb must glide to the toolbar's left margin");
  assert(Math.abs(composeOrb.y - idleOrb.y) <= 1, "Opening the composer must not move the orb vertically");
  if (process.env.PVO_ASSISTANT_SCREENSHOT) {
    const { dir, name, ext } = parse(process.env.PVO_ASSISTANT_SCREENSHOT);
    await page.screenshot({ path: join(dir, `${name}-typing${ext || ".png"}`) });
  }
  assert(await page.locator(".transport").evaluate(element => !!element.closest("[inert]")));
  await tapEmptyToolbar();
  await phase("idle").waitFor();
  await toolbar.getByRole("button", { name: "Edit clip", exact: true }).waitFor();
  await page.locator('[data-reorder-layer^="component:"]').first().click();
  await assertToolbarRestored(toolbarBefore, toolLabelsBefore);
  for (const selector of [".previewArea", ".transport", ".editorHead"]) {
    await orb.click();
    await field.waitFor();
    const bounds = await page.locator(selector).boundingBox();
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await phase("idle").waitFor();
    await toolbar.getByRole("button", { name: "Edit clip", exact: true }).waitFor();
    await page.locator('[data-reorder-layer^="component:"]').first().click();
  }
  await orb.click();
  await field.waitFor();
  await submit("Softer colours");
  await assertReviewFits();
  await assertToolbarReplacement(toolbarBefore);
  assert.deepEqual(await workspaceBounds(), geometryBefore, "Review must preserve the workspace layout");
  const reviewOrb = await orb.boundingBox();
  assert(reviewOrb && Math.abs(reviewOrb.y - idleOrb.y + 14) <= 1,
    "The review orb must rise 14px above its idle position");
  await page.locator('[data-proposed="true"]').waitFor();
  assert.equal(await page.locator(".transportTime").innerText(), transportBefore);
  const hold = review.getByRole("button", { name: "Hold to view before" });
  await hold.focus();
  await page.keyboard.down("Space");
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0);
  await page.keyboard.up("Space");
  await page.locator('[data-proposed="true"]').waitFor();
  await tapEmptyToolbar();
  await page.keyboard.press("Escape");
  await page.mouse.click(reviewOrb.x + reviewOrb.width / 2, reviewOrb.y + reviewOrb.height / 2);
  assert.equal(await phase("review").count(), 1, "Empty-toolbar taps, Escape and orb taps cannot discard review");
  await review.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await field.inputValue(), "Softer colours");
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0);
  await settle();
  await assertToolbarReplacement(toolbarBefore, true);
  await submit("Softer colours");
  await page.getByRole("button", { name: "Larger heading", exact: true }).click();
  await phase("review").waitFor();
  await settle();
  await assertReviewFits();
  await assertToolbarReplacement(toolbarBefore);
  const tags = review.getByRole("list", { name: "Requested changes" });
  assert.match(await tags.innerText(), /Larger heading/, "Follow-ups must appear as request tags");
  await review.getByRole("button", { name: "Edit request", exact: true }).click();
  await field.waitFor();
  const refinedRequest = await field.inputValue();
  assert.match(refinedRequest, /Softer colours/);
  assert.match(refinedRequest, /Larger heading/);
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0, "Editing must return to the unmodified component");
  await field.press("Enter");
  await phase("review").waitFor();
  await settle();
  await page.getByRole("button", { name: "Bolder", exact: true }).click();
  await phase("review").waitFor();
  await settle();
  await review.getByRole("button", { name: "Undo", exact: true }).click();
  assert.match(await field.inputValue(), /Softer colours/);
  assert.match(await field.inputValue(), /Larger heading/);
  assert.match(await field.inputValue(), /Bolder/, "Undo must preserve the base request and every refinement");
  await field.press("Enter");
  await phase("review").waitFor();
  await settle();
  if (process.env.PVO_ASSISTANT_SCREENSHOT) await page.screenshot({ path: process.env.PVO_ASSISTANT_SCREENSHOT });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 740, height: 430 }]) {
    await page.setViewportSize(viewport);
    await settle();
    await assertReviewFits();
    await assertToolbarReplacement();
    if (process.env.PVO_ASSISTANT_SCREENSHOT) {
      const { dir, name, ext } = parse(process.env.PVO_ASSISTANT_SCREENSHOT);
      await page.screenshot({ path: join(dir, `${name}-${viewport.width}x${viewport.height}${ext || ".png"}`) });
    }
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await settle();
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  await settle();
  await assertReviewFits();
  await assertToolbarReplacement();
  const safeOrb = await page.locator("[data-assistant-orb]").boundingBox();
  assert(safeOrb && safeOrb.y + safeOrb.height <= 932 - 34 + 1,
    "The active orb must stay above the bottom phone safe area");
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  await settle();
  await review.getByRole("button", { name: "Keep", exact: true }).click();
  await phase("idle").waitFor();
  await assertToolbarRestored(toolbarBefore, toolLabelsBefore);
  assert.equal(await page.locator('[data-notification-id]').count(), 0,
    "Keeping an assistant change must be quiet");
  assert.equal(await page.locator('.compCustomShell').count(), 1, "Keep persists the PVO preview");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator('.compCustomShell').count(), 0, "One Undo removes the whole proposal including follow-up");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.locator('.compCustomShell').waitFor();
  await orb.click();
  await submit("make it blue");
  assert.match(await review.innerText(), /Changed [1-9]\d* style/,
    "A validated HTTP proposal must explain its applied changes");
  await review.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await field.inputValue(), "make it blue");
  await field.fill("Build me a JavaScript dashboard");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await phase("typing").waitFor();
  const notice = page.locator('[data-notification-id="assistantUnsupported"]');
  await notice.waitFor();
  assert.equal(await notice.getAttribute("data-severity"), "error");
  assert((await notice.innerText()).includes("Request not supported."));
  assert.equal(await field.inputValue(), "Build me a JavaScript dashboard", "Failures must preserve the user's request");
  assert.equal(await page.locator(".orbAssistant").getByText("Request not supported.", { exact: true }).count(), 0,
    "The assistant must not repeat the error beside its input");
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await notice.waitFor({ state: "hidden" });
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0, "Unsupported requests must not generate fake code");
  provider.failNext(503);
  await field.fill("Softer colours");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await phase("typing").waitFor();
  assert.equal(await field.inputValue(), "Softer colours", "An unavailable provider must preserve the request");
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0, "Unavailable live AI must never use a preset fallback");
  assert.equal(await page.getByText("Untrusted provider detail must stay hidden.", { exact: true }).count(), 0);
  assert(provider.requests.length >= 8, "Every proposal must cross the HTTP provider boundary");
  await page.keyboard.press("Escape");
  await phase("idle").waitFor();
  await assertToolbarRestored(toolbarBefore, toolLabelsBefore);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await orb.click();
  await submit("Bolder");
  await assertReviewFits();
  await assertToolbarReplacement(toolbarBefore);
  const motion = await page.locator(".orbAssistant").evaluate(element =>
    element.getAnimations({ subtree: true }).map(animation => animation.playState));
  assert.deepEqual(motion, [], "Reduced motion must remove glides, pulses and chip animations");
  assert.deepEqual(errors, []);
  console.log("Orb assistant passed: stable undimmed workspace, 100px toolbar, context miniature, centred raised review, Before, explicit dismissal, preserved request tags, atomic Keep/history, phone/landscape layouts and reduced motion.");
} catch (error) {
  console.error(error.stack);
  console.error((await page.locator("body").innerText()).slice(0, 1800));
  console.error(errors);
  if (process.env.PVO_ASSISTANT_SCREENSHOT) await page.screenshot({ path: process.env.PVO_ASSISTANT_SCREENSHOT }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
