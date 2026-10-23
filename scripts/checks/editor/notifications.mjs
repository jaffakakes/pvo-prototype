import { launchBrowser } from "../helpers/browser.mjs";
import assert from "node:assert/strict";


const browser = await launchBrowser({
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
  await show("assistantResponseInvalid", { scope: "fixture", currentAttempt: true });
  await notice.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await notice.getAttribute("data-severity"), "error");
  assert((await notice.innerText()).includes("AI response was invalid. Try again."));
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
  await show("assistantResponseInvalid", { scope: "fixture", currentAttempt: true });
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
  await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T12:00:01Z"));
  await dismiss.click();
  assert.equal(await page.evaluate(() => window.notificationFixture.useNotifications.getState().unresolved.length), 2,
    "Dismissal does not resolve durable failures");
  assert(await page.locator("[data-notification-root] button:visible").count() > 0,
    "Acknowledged issues need an accessible way back");
  const reminder = page.getByRole("button", { name: "Saving paused", exact: true });
  await reminder.waitFor();
  await page.clock.runFor(9999);
  assert.equal(await reminder.count(), 1, "Saving paused remains for ten seconds");
  await page.clock.runFor(1);
  assert.equal(await reminder.count(), 0, "Saving paused dismisses after ten seconds");
  assert.equal(await page.evaluate(() => window.notificationFixture.useNotifications.getState().unresolved.length), 2,
    "Expiring the reminder does not resolve or discard unsaved work");
  await page.evaluate(() => {
    const fixture = window.notificationFixture;
    fixture.showNotificationIssue(fixture.useNotifications.getState().unresolved.find(issue => issue.id === "saveFailed").key);
  });
  await notice.waitFor();
  await dismiss.click();
  await reminder.click();
  const closeDetails = page.getByRole("button", { name: "Close save details", exact: true });
  await closeDetails.waitFor();
  await page.clock.runFor(10_000);
  assert.equal(await closeDetails.count(), 1, "The reminder timer must not close open recovery details");
  await closeDetails.click();
  assert.equal(await reminder.count(), 0);
  await page.clock.resume();
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
