import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { installAssistantFixture } from "./assistant-fixture.mjs";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
await installAssistantFixture(context);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));
const overlay = page.locator(".compOverlay");
const review = page.getByRole("region", { name: "Review assistant change" });

async function settle() {
  await page.locator(".editorWorkspace").evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

async function bounds() {
  return overlay.evaluate(element => {
    const rect = target => {
      const { left, top, width, height } = target.getBoundingClientRect();
      return { left, top, width, height };
    };
    const previewElement = element.closest(".pvBox");
    const preview = rect(previewElement);
    const previewStyle = getComputedStyle(previewElement);
    const borderLeft = parseFloat(previewStyle.borderLeftWidth);
    const borderTop = parseFloat(previewStyle.borderTopWidth);
    const contentWidth = preview.width - borderLeft - parseFloat(previewStyle.borderRightWidth);
    const contentHeight = preview.height - borderTop - parseFloat(previewStyle.borderBottomWidth);
    const outer = rect(element);
    const iframe = element.querySelector(".compCustomRuntime iframe");
    const frame = iframe ? rect(iframe) : null;
    const card = iframe?.contentDocument?.querySelector(".pvo-card");
    const inner = card ? rect(card) : null;
    const scale = frame ? frame.width / parseFloat(iframe.style.width) : 1;
    const rendered = inner ? {
      left: frame.left + inner.left * scale, top: frame.top + inner.top * scale,
      width: inner.width * scale, height: inner.height * scale,
    } : null;
    const content = rendered ?? outer;
    return {
      outer, frame, rendered,
      center: { x: parseFloat(element.style.left) / 100, y: parseFloat(element.style.top) / 100 },
      centerOffset: { x: content.left + content.width / 2 - preview.left - borderLeft,
        y: content.top + content.height / 2 - preview.top - borderTop },
      contentWidth, contentHeight, outlined: getComputedStyle(element).outlineStyle !== "none",
    };
  });
}

async function assertFitted(expectedCenter) {
  await page.waitForFunction(() => {
    const frame = document.querySelector(".compCustomRuntime iframe");
    return frame?.contentDocument?.querySelector(".pvo-card");
  });
  await settle();
  const measured = await bounds();
  assert(measured.frame && measured.rendered);
  for (const key of ["left", "top", "width", "height"]) {
    assert(Math.abs(measured.outer[key] - measured.frame[key]) < 1,
      `Selection bounds must fit the rendered frame (${key}): ${JSON.stringify(measured)}`);
    assert(Math.abs(measured.outer[key] - measured.rendered[key]) < 2,
      `Selection bounds must fit the visible Card (${key}): ${JSON.stringify(measured)}`);
  }
  for (const [axis, length] of [["x", measured.contentWidth], ["y", measured.contentHeight]]) {
    assert(Math.abs(measured.centerOffset[axis] - expectedCenter[axis] * length) < 1,
      `PVO content must preserve its authored center (${axis}): ${JSON.stringify(measured)}`);
  }
  assert(measured.outlined, "The fitted selected/proposed component must retain its outline");
  return measured;
}

async function assertCardColour(colour, timeout = 10000) {
  await page.waitForFunction(expected => {
    const frame = document.querySelector(".compCustomRuntime iframe");
    const card = frame?.contentDocument?.querySelector(".pvo-card");
    return card && frame.contentWindow.getComputedStyle(card).backgroundColor === expected;
  }, colour, { timeout });
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const visit = page.getByRole("button", { name: "Visit Site", exact: true });
  if (await visit.isVisible()) await visit.click();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url)));
  await page.getByRole("button", { name: "Open editor", exact: true }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Show a message" }).click();
  await page.getByRole("dialog", { name: "Message", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await settle();
  const original = await bounds();
  await page.locator("[data-assistant-orb]").click();
  await page.getByRole("textbox", { name: "Describe a change" }).fill("Softer colours");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await review.waitFor();
  await assertFitted(original.center);

  await page.getByRole("button", { name: "Larger heading", exact: true }).click();
  await review.waitFor();
  await assertFitted(original.center);
  const before = review.getByRole("button", { name: "Hold to view before" });
  await before.focus();
  await page.keyboard.down("Space");
  assert.equal(await page.locator(".compCustomRuntime").count(), 0);
  await page.keyboard.up("Space");
  await assertFitted(original.center);
  await review.getByRole("button", { name: "Keep", exact: true }).click();
  await page.locator('[data-assistant-phase="idle"]').waitFor();
  const kept = await assertFitted(original.center);

  const center = { x: kept.outer.left + kept.outer.width / 2, y: kept.outer.top + kept.outer.height / 2 };
  const points = factor => [0, 1].map(id => ({ id, x: center.x + (id ? 14 : -14) * factor, y: center.y }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(1) });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(1 + .4 * step / 10) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const enlarged = await assertFitted(original.center);
  assert(enlarged.outer.width > kept.outer.width * 1.3, "Custom PVO components must retain pinch scaling");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const restored = await assertFitted(original.center);
  assert(Math.abs(restored.outer.width - kept.outer.width) < 1, "One Undo must restore the original component scale");

  // The original now uses PVO too: compare actual pixels, not just the Before badge.
  await assertCardColour("rgb(242, 240, 233)");
  await page.locator("[data-assistant-orb]").click();
  await page.getByRole("textbox", { name: "Describe a change" }).fill("Make it blue");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await review.waitFor();
  await assertCardColour("rgb(96, 165, 250)");
  await before.focus();
  await page.keyboard.down("Space");
  await assertCardColour("rgb(242, 240, 233)", 200);
  await page.keyboard.up("Space");
  await assertCardColour("rgb(96, 165, 250)", 200);
  await review.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe a change" }).press("Escape");
  await page.locator('[data-assistant-phase="idle"]').waitFor();
  await assertCardColour("rgb(242, 240, 233)");

  for (const viewport of [{ width: 320, height: 740 }, { width: 740, height: 430 }]) {
    await page.setViewportSize(viewport);
    await assertFitted(original.center);
  }
  assert.deepEqual(errors, []);
  console.log("PVO overlay bounds passed: Card center, fitted outline, source replacement, immediate code-owned Before comparison, Keep, pinch/Undo and responsive scaling.");
} finally {
  await context.close();
  await browser.close();
}
