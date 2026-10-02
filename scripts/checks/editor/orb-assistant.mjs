import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installAssistantFixture } from "./assistant-fixture.mjs";

// The companion assistant-thread check owns history and dock geometry. This
// journey keeps the component proposal/review safeguards on a public UI route.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
const provider = await installAssistantFixture(context);
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const orb = page.locator("[data-assistant-orb]");
const thread = page.getByRole("dialog", { name: "Restyle thread" });
const input = page.getByRole("textbox", { name: "Describe a change" });
const review = page.getByRole("region", { name: "Review assistant change", exact: true });
const phase = value => page.locator(`[data-assistant-phase="${value}"]`);
const settle = () => page.waitForTimeout(550);
async function submit(text) {
  await settle();
  await input.fill(text);
  await input.press("Enter");
  await review.waitFor();
  await settle();
  assert.equal(await thread.count(), 0, "The thread closes for explicit component review");
}
async function checkReviewFits() {
  const host = await page.locator("[data-assistant-region]").boundingBox();
  const bounds = await review.boundingBox();
  assert(host && bounds && bounds.y >= host.y - 1 && bounds.y + bounds.height <= host.y + host.height + 1);
  for (const name of ["Keep", "Hold to view before", "Undo"]) {
    const button = review.getByRole("button", { name, exact: true });
    await button.click({ trial: true });
    assert((await button.boundingBox()).height >= 42);
  }
  assert.equal(await page.locator('[aria-label="Try another change"] button').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  await page.goto(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)));
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await orb.click();
  await thread.waitFor();
  assert.equal(await thread.getByRole("button", { name: "Send request", exact: true }).isDisabled(), true);
  await thread.getByRole("button", { name: "Close Restyle thread" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Show a message" }).click();
  await page.getByRole("dialog", { name: "Message", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await phase("idle").waitFor();
  const originalTime = await page.locator(".transportTime").innerText();
  await orb.click();
  await submit("Softer colours");
  await checkReviewFits();
  await page.locator('[data-proposed="true"]').waitFor();
  assert.equal(await page.locator(".transportTime").innerText(), originalTime);
  const before = review.getByRole("button", { name: "Hold to view before" });
  await before.focus();
  await page.keyboard.down("Space");
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0);
  await page.keyboard.up("Space");
  await page.locator('[data-proposed="true"]').waitFor();
  await page.keyboard.press("Escape");
  const orbBounds = await orb.boundingBox();
  await page.mouse.click(orbBounds.x + orbBounds.width / 2, orbBounds.y + orbBounds.height / 2);
  assert.equal(await review.count(), 1, "Escape and orb taps cannot discard review");
  await page.getByRole("button", { name: "Larger heading", exact: true }).click();
  await phase("review").waitFor();
  await settle();
  assert.match(await review.getByRole("list", { name: "Requested changes" }).innerText(), /Larger heading/);
  await review.getByRole("button", { name: "Edit request", exact: true }).click();
  await input.waitFor();
  await settle();
  assert.match(await input.inputValue(), /Softer colours; Larger heading/);
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0);
  await submit(await input.inputValue());
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 740, height: 430 }]) {
    await page.setViewportSize(viewport);
    await settle();
    await checkReviewFits();
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await settle();
  await review.getByRole("button", { name: "Keep", exact: true }).click();
  await phase("idle").waitFor();
  assert.equal(await page.locator('[data-notification-id]').count(), 0, "Keep remains quiet");
  await page.locator(".compCustomShell").waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator(".compCustomShell").count(), 0, "One history step reverts all refinements");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.locator(".compCustomShell").waitFor();
  await orb.click();
  await input.fill("Build me a JavaScript dashboard");
  await input.press("Enter");
  await phase("typing").waitFor();
  const notice = page.locator('[data-notification-id="assistantUnsupported"]');
  await notice.waitFor();
  assert.equal(await input.inputValue(), "Build me a JavaScript dashboard");
  assert.equal(await thread.getByText("Request not supported.", { exact: true }).count(), 0);
  await notice.getByRole("button", { name: "Dismiss notification" }).click();
  provider.failNext(503);
  await input.fill("Softer colours");
  await input.press("Enter");
  await phase("typing").waitFor();
  assert.equal(await input.inputValue(), "Softer colours");
  assert.equal(await page.locator('[data-proposed="true"]').count(), 0);
  assert.equal(await page.getByText("Untrusted provider detail must stay hidden.", { exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await orb.click();
  await submit("Bolder");
  await checkReviewFits();
  assert.deepEqual(await page.locator(".orbAssistant").evaluate(element => element.getAnimations({ subtree: true }).map(animation => animation.playState)), []);
  assert.deepEqual(errors, []);
  console.log("Orb review passed: explicit review, Before, refinement preservation, atomic Keep/history, responsive review, curated failures and reduced motion.");
} catch (error) {
  console.error(error.stack);
  console.error((await page.locator("body").innerText()).slice(0, 1800));
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
