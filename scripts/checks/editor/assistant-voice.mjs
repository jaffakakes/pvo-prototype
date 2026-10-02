import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installAssistantFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
await installAssistantFixture(context);

// Replace only the browser capability. App gestures, compiler, application and history remain real.
await context.addInitScript(() => {
  const state = { starts: 0, stops: 0, aborts: 0, autoStart: true, current: null };
  class FakeRecognition {
    constructor() { state.current = this; }
    start() { state.starts++; if (state.autoStart) queueMicrotask(() => this.onstart?.()); }
    stop() { state.stops++; }
    abort() { state.aborts++; }
    result(text, isFinal) {
      this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] });
    }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, writable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, writable: true, value: undefined });
  window.voiceFixture = state;
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));
const orb = page.locator("[data-assistant-orb]");
const assistant = page.locator("[data-assistant-phase]");
const field = page.getByRole("textbox", { name: "Describe a change" });
const phase = value => page.locator(`[data-assistant-phase="${value}"]`).waitFor();
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function settle() {
  await frame();
  await page.locator(".editorWorkspace").evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

async function center() {
  await settle();
  const box = await orb.boundingBox();
  assert(box, "Selected component must expose its assistant orb");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function mouseDown() {
  const point = await center();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
}

async function snapshot() {
  return page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const state = useCapture.getState();
    // History cloning can materialize absent optional keys as undefined; compare saved values.
    return JSON.parse(JSON.stringify({ scenes: state.scenes, past: state.past, future: state.future }));
  });
}

async function resetNoticeScenario() {
  // These independent failures do not test the global 10-second rate limiter.
  await page.evaluate(async () => {
    const { resetNotifications, setNotificationsBusy, useNotifications } = await import("/src/state/notifications/notificationStore.ts");
    const busy = useNotifications.getState().busy;
    resetNotifications();
    setNotificationsBusy(busy);
  });
}

async function assertNotice(id, copy, severity) {
  const notice = page.locator(`[data-notification-id="${id}"]`);
  await notice.waitFor();
  assert.equal(await notice.getAttribute("data-severity"), severity);
  assert.equal(await page.getByText(copy, { exact: true }).count(), 1, "A failure must have one message surface");
  assert.equal(await assistant.getByText(copy, { exact: true }).count(), 0, "No error belongs beside the input");
  return notice;
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Add a note" }).click();
  await page.getByRole("dialog", { name: "Note", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await phase("idle");
  let original = await snapshot();
  await resetNoticeScenario();

  await orb.click();
  await phase("typing");
  assert.equal(await page.evaluate(() => voiceFixture.starts), 0, "A tap must open typing without recording");
  await field.fill("Keep my draft");
  await mouseDown();
  await page.waitForTimeout(230);
  await page.mouse.up();
  assert.equal(await page.locator('[data-notification-id="voiceHoldShort"]').count(), 0,
    "A release before the 320ms threshold is a tap, not an incomplete voice request");
  assert.equal(await page.evaluate(() => voiceFixture.starts), 0, "A tap must not start recognition");
  assert.equal(await field.evaluate(element => element === document.activeElement), true,
    "Tapping the composing orb must focus the request field");
  await mouseDown();
  await page.waitForFunction(() => voiceFixture.starts === 1);
  await phase("listening");
  await page.evaluate(() => voiceFixture.current.result("softer", true));
  await page.mouse.up();
  await page.evaluate(() => voiceFixture.current.onend?.());
  await phase("typing");
  await assertNotice("voiceHoldShort", "Hold a little longer.", "warning");
  assert.equal(await field.inputValue(), "Keep my draft");
  await field.focus();
  let reachedDismiss = false;
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      allowed: !!document.activeElement?.closest("[data-assistant-region], [data-notification-root]"),
      label: document.activeElement?.getAttribute("aria-label"),
    }));
    assert(focused.allowed, "Tab must not enter the inert editor behind the assistant");
    if (focused.label === "Dismiss notification") { reachedDismiss = true; break; }
  }
  assert(reachedDismiss, "Assistant focus cycling must include notification dismissal");
  await page.keyboard.press("Enter");
  await page.locator('[data-notification-id="voiceHoldShort"]').waitFor({ state: "detached" });
  assert.equal(await field.inputValue(), "Keep my draft");

  const point = await center();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, ...point }] });
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => voiceFixture.starts), 1, "Recording must wait for the hold threshold");
  await page.waitForFunction(() => voiceFixture.starts === 2);
  await phase("listening");
  await page.evaluate(() => voiceFixture.current.result("make it", false));
  await assistant.getByText("make it", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => voiceFixture.stops), 1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => voiceFixture.stops === 2);
  assert.equal(await assistant.getAttribute("data-assistant-phase"), "listening", "Release must await finalized words");
  await page.evaluate(() => {
    voiceFixture.current.result("Softer colours", true);
    voiceFixture.current.onend?.();
  });
  await phase("idle");
  const applied = await snapshot();
  assert.equal(applied.past.length, original.past.length + 1, "Final voice words apply as one undoable edit");
  assert.notDeepEqual(applied.scenes, original.scenes);
  const appliedNotice = page.locator('[data-notification-id="assistantApplied"]');
  await appliedNotice.waitFor();
  await appliedNotice.hover();
  await page.waitForTimeout(250);
  assert.equal(await assistant.getAttribute("data-assistant-phase"), "idle", "Trailing events must not send another request");
  assert.deepEqual(await snapshot(), applied, "Trailing speech events must not apply a second edit");
  await appliedNotice.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await snapshot();
  assert.deepEqual(undone.scenes, original.scenes, "Toast Undo restores all component source and fields");
  assert.deepEqual(undone.past, original.past);
  assert.equal(undone.future.length, original.future.length + 1);
  original = undone;
  await orb.click();
  await phase("typing");

  // Keyboard hold uses the same threshold and can be cancelled without a request.
  await orb.focus();
  await page.keyboard.down("Space");
  await page.waitForFunction(() => voiceFixture.starts === 3);
  await phase("listening");
  await page.evaluate(() => voiceFixture.current.result("Discard this", true));
  await page.keyboard.press("Escape");
  await page.keyboard.up("Space");
  await page.waitForFunction(() => voiceFixture.aborts > 0);
  assert.notEqual(await assistant.getAttribute("data-assistant-phase"), "listening");
  assert.deepEqual(await snapshot(), original);

  // Release while permission is pending must prevent a microphone starting later.
  if (await assistant.getAttribute("data-assistant-phase") === "idle") await orb.click();
  await phase("typing");
  await field.fill("Keep my pending draft");
  await resetNoticeScenario();
  await page.evaluate(() => { voiceFixture.autoStart = false; });
  await mouseDown();
  await page.waitForFunction(() => voiceFixture.starts === 4);
  await page.mouse.up();
  await phase("typing");
  await assertNotice("voiceHoldShort", "Hold a little longer.", "warning");
  const aborts = await page.evaluate(() => voiceFixture.aborts);
  await page.evaluate(() => voiceFixture.current.onstart?.());
  assert.equal(await page.evaluate(() => voiceFixture.aborts), aborts + 1);
  assert.equal(await field.inputValue(), "Keep my pending draft");
  await page.evaluate(() => { voiceFixture.current.onend?.(); voiceFixture.autoStart = true; });

  await resetNoticeScenario();
  await mouseDown();
  await page.waitForFunction(() => voiceFixture.starts === 5);
  await page.evaluate(() => voiceFixture.current.onerror?.({ error: "not-allowed" }));
  await page.mouse.up();
  await phase("typing");
  await assertNotice("voiceDenied", "Microphone access denied.", "error");
  assert.equal(await field.inputValue(), "Keep my pending draft");

  await page.evaluate(() => { voiceFixture.current.onend?.(); window.SpeechRecognition = undefined; });
  await resetNoticeScenario();
  await mouseDown();
  await page.waitForTimeout(380);
  await page.mouse.up();
  await phase("typing");
  await assertNotice("voiceUnavailable", "Voice unavailable.", "info");
  assert.equal(await page.evaluate(() => voiceFixture.starts), 5);
  assert.equal(await field.inputValue(), "Keep my pending draft");

  await resetNoticeScenario();
  await field.fill("Build a dashboard for me");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await phase("typing");
  await assertNotice("assistantUnsupported", "Request not supported.", "error");
  assert.equal(await field.inputValue(), "Build a dashboard for me");
  await page.keyboard.press("Escape");
  await phase("idle");
  assert.equal(await page.locator('[data-notification-id="assistantUnsupported"]').count(), 0,
    "Closing the workflow clears its notification scope");
  assert.deepEqual(await snapshot(), original);
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    useCapture.getState().patch({ playing: true });
  });
  await orb.click();
  await phase("typing");
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().playing), false,
    "Opening the assistant must pause playback");
  await page.keyboard.press("Escape");
  await phase("idle");
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().playing), true,
    "Closing the assistant must restore its previous playback state");
  await orb.click();
  await phase("typing");
  await field.fill("Bolder");
  await field.press("Enter");
  await page.locator('[data-notification-id="assistantApplied"]').waitFor();
  await phase("idle");
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().playing), true,
    "Applying an edit must restore its previous playback state");
  await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().patch({ playing: false }));
  assert.deepEqual(errors, []);
  console.log("Assistant voice checks passed: 320ms tap/hold vocabulary, two-word minimum, speech lifecycle, typed notifications, preserved drafts, keyboard dismissal, playback restoration and scope cleanup.");
} catch (error) {
  console.error(error.stack);
  console.error(await page.evaluate(async () => {
    const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
    const { useNotifications } = await import("/src/state/notifications/notificationStore.ts");
    return {
      phase: useAssistant.getState().phase,
      failure: useAssistant.getState().failureDetail,
      notifications: useNotifications.getState(),
      voice: { starts: voiceFixture.starts, stops: voiceFixture.stops, aborts: voiceFixture.aborts },
    };
  }));
  console.error((await page.locator("body").innerText()).slice(0, 1600));
  console.error(errors);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
