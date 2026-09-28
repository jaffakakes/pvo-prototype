import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const notice = page.locator("[data-notification-id]");

async function show(id, options = {}) {
  await page.evaluate(({ id, options }) => window.notificationFixture.notify(id, options), { id, options });
}
async function reset() {
  await page.evaluate(() => window.notificationFixture.resetNotifications());
  await notice.waitFor({ state: "hidden" });
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    window.notificationFixture = await import("/src/state/notifications/notificationStore.ts");
    window.notificationCapture = (await import("/src/store.ts")).useCapture;
  });
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  await show("assistantUnsupported", { scope: "fixture", currentAttempt: true });
  await notice.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await notice.getAttribute("data-severity"), "error");
  assert((await notice.innerText()).includes("Request not supported."));
  const bounds = await notice.boundingBox();
  assert(bounds && bounds.y >= 59 && bounds.x >= 16 && bounds.x + bounds.width <= 304,
    `Banner must fit below safe area with phone margins: ${JSON.stringify(bounds)}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const dismiss = page.getByRole("button", { name: "Dismiss notification", exact: true });
  const closeBounds = await dismiss.boundingBox();
  assert(closeBounds.width >= 44 && closeBounds.height >= 44, "Dismiss must remain a touch target");
  if (process.env.PVO_NOTIFICATION_SCREENSHOT) await page.screenshot({ path: process.env.PVO_NOTIFICATION_SCREENSHOT });

  await notice.hover();
  await page.waitForTimeout(4300);
  assert.equal(await notice.count(), 1, "Hover pauses dismissal");
  await page.mouse.move(2, 400);
  await notice.waitFor({ state: "hidden", timeout: 4500 });
  await show("assistantUnsupported", { scope: "fixture", currentAttempt: true });
  assert.equal(await notice.count(), 0, "Repeated event must not restart the banner inside the cooldown");

  for (const [id, kind] of [["voiceHoldShort", "warning"], ["voiceUnavailable", "info"]]) {
    await reset();
    await show(id, { currentAttempt: true });
    await notice.waitFor();
    assert.equal(await notice.getAttribute("data-severity"), kind);
    await dismiss.focus();
    await page.waitForTimeout(4300);
    assert.equal(await notice.count(), 1, "Keyboard focus pauses dismissal");
    await page.keyboard.press("Enter");
    await notice.waitFor({ state: "hidden" });
  }

  await reset();
  await show("saveFailed", { scope: "project" });
  await show("recordingFailed", { scope: "clip:1" });
  await show("voiceHoldShort", { currentAttempt: true });
  assert.equal(await notice.getAttribute("data-notification-id"), "saveFailed",
    "Brief events and a second critical issue cannot replace the current critical notice");
  await page.waitForTimeout(4300);
  assert.equal(await notice.count(), 1, "Save failures never expire");
  await dismiss.click();
  assert.equal(await page.evaluate(() => window.notificationFixture.useNotifications.getState().unresolved.length), 2,
    "Dismissal does not resolve durable failures");
  assert(await page.locator("[data-notification-root] button:visible").count() > 0,
    "Acknowledged issues need an accessible way back");
  await page.evaluate(() => {
    const fixture = window.notificationFixture;
    fixture.resolveNotification("saveFailed", "project");
    fixture.resolveNotification("recordingFailed", "clip:1");
  });
  assert.equal(await page.evaluate(() => window.notificationFixture.useNotifications.getState().unresolved.length), 0);

  await reset();
  await page.evaluate(() => window.notificationCapture.getState().patch({ recording: true }));
  await page.waitForTimeout(50);
  await show("voiceUnavailable");
  assert.equal(await notice.count(), 0, "Unrelated brief notifications are suppressed while recording");
  await show("voiceDenied", { currentAttempt: true });
  await notice.waitFor();
  await page.evaluate(() => window.notificationCapture.getState().patch({ recording: false }));
  await reset();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await show("voiceHoldShort", { currentAttempt: true });
  await notice.waitFor();
  assert.equal(await notice.evaluate(element => getComputedStyle(element).animationName), "none",
    "Reduced motion must remove the entrance animation");
  assert.deepEqual(errors, []);
  console.log("Notifications passed: mobile safe area, bounded copy, severity, 44px close, hover/focus pause, expiry, deduplication, durable issues, busy suppression and reduced motion.");
} finally {
  await context.close();
  await browser.close();
}
