import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL(process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/");
  url.searchParams.set("home", "1");
  await page.goto(url.href);
  await page.getByRole("button", { name: "Try a sample clip", exact: true }).click();
  await page.getByRole("button", { name: "Start editing", exact: true }).click();
  await page.locator("[data-desktop-editor]").waitFor();
  await page.setViewportSize({ width: 390, height: 850 });
  const slider = page.getByRole("slider", { name: "Timeline playhead" });
  await slider.waitFor();
  await page.waitForFunction(() => document.querySelector(".pvVideo")?.readyState >= 2);
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  const snapshot = () => page.evaluate(() => ({
    time: Number(document.querySelector('[role="slider"][aria-label="Timeline playhead"]').getAttribute("aria-valuenow")),
    head: document.querySelector(".playhead").getBoundingClientRect().x,
    strip: document.querySelector(".strip").getBoundingClientRect().x,
  }));
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 0.06, `${message}: ${actual} vs ${expected}`);
  async function touchDrag(dx, { cancel = false, line = false } = {}) {
    const box = await slider.boundingBox();
    const x = box.x + box.width / 2;
    const y = line ? box.y + box.height / 2 : box.y + 12;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 5, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    await page.waitForTimeout(80);
  }

  const initial = await snapshot();
  await touchDrag(100);
  const forward = await snapshot();
  near(forward.time, initial.time + 2, "Dragging the head seeks forward");
  near(forward.head, initial.head + 100, "The head follows the finger and stays after release");
  near(forward.strip, initial.strip, "Visible clips stay still while dragging the head");
  await page.waitForFunction(time => Math.abs(document.querySelector(".pvVideo").currentTime - time) < 0.08, forward.time);
  await touchDrag(-50, { line: true });
  near((await snapshot()).time, initial.time + 1, "The playhead line also supports dragging backwards");

  const beforeCancel = await snapshot();
  await touchDrag(70, { cancel: true });
  const cancelled = await snapshot();
  near(cancelled.time, beforeCancel.time, "An interrupted gesture restores the time");
  near(cancelled.head, beforeCancel.head, "An interrupted gesture restores the head");
  await touchDrag(50);
  near((await snapshot()).time, beforeCancel.time + 1, "A fresh gesture works after cancellation");

  const beforePan = await snapshot();
  const timeline = await page.locator(".tl").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: timeline.x + 330, y: timeline.y + 12 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: timeline.x + 280, y: timeline.y + 12 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const panned = await snapshot();
  near(panned.time, beforePan.time + 1, "Swiping the timeline still scrubs");
  near(panned.head, beforePan.head, "Timeline swipes keep the head stationary");

  await slider.focus();
  await page.keyboard.press("Home");
  near((await snapshot()).time, 0, "Home seeks to the start");
  await touchDrag(-50);
  near((await snapshot()).time, 0, "Seeking cannot go before the start");
  await page.keyboard.press("ArrowRight");
  near((await snapshot()).time, 0.1, "Keyboard seeking works");
  await page.keyboard.press("End");
  near((await snapshot()).time, Number(await slider.getAttribute("aria-valuemax")), "End seeks to the scene end");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(150);
  assert((await slider.boundingBox()).x + 20 <= 320, "The head remains reachable on a smaller screen");
  await page.keyboard.press("Home");
  await touchDrag(50);
  near((await snapshot()).time, 1, "Dragging works after resize");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".pvVideo").currentTime > 1.4);
  await touchDrag(25);
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  assert(await page.locator(".pvVideo").evaluate(video => video.paused), "Dragging pauses playback");

  await page.setViewportSize({ width: 390, height: 850 });
  await slider.focus();
  await page.keyboard.press("Home");
  await page.locator(".tools").getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Text content" }).fill("Playhead timing");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".tools").getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await page.getByRole("button", { name: "Use playhead", exact: true }).click();
  await page.locator('.tl[data-time-pick="true"]').waitFor();
  await page.waitForTimeout(400);
  const originalTextLeft = await page.locator(".textBar").evaluate(element => element.style.left);
  await touchDrag(50);
  near((await snapshot()).time, 1, "Dragging works inside the timing picker");
  assert.equal(await page.locator(".textBar").evaluate(element => element.style.left), originalTextLeft, "Draft scrubbing does not edit text timing");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  near((await snapshot()).time, 0, "Cancelling the timing picker restores its original time");
  assert.equal(await page.getByRole("spinbutton", { name: "Text start", exact: true }).inputValue(), "0");
  await page.getByRole("button", { name: "Use playhead", exact: true }).click();
  await page.waitForTimeout(400);
  await touchDrag(50);
  await page.getByRole("button", { name: "Use 0:01", exact: true }).click();
  assert.equal(await page.getByRole("spinbutton", { name: "Text start", exact: true }).inputValue(), "1", "Accepting saves the dragged time");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("Mobile playhead: touch dragging, preview seeking, release, cancellation, timeline swipes, bounds, keyboard, resize, playback and timing picker passed.");
} finally {
  await browser.close();
}
