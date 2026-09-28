import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = resolve("share/assets/preview.mp4");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

function assertInside(inner, outer, label) {
  assert.ok(inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1,
    `${label} escapes its available height: ${JSON.stringify({ inner, outer })}`);
}

async function inspect(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing editor element: ${selector}`);
      const { top, bottom, height, left, right, width } = element.getBoundingClientRect();
      return { top, bottom, height, left, right, width };
    };
    const visual = window.visualViewport;
    const app = document.querySelector(".app");
    const root = document.querySelector("#root");
    if (!app || !root) throw new Error("The editor did not render");
    return {
      visible: { top: visual?.offsetTop ?? 0, bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? innerHeight) },
      app: rect(".app"),
      header: rect(".editorHead"),
      back: rect(".backBtn"),
      title: rect(".editorTitle"),
      next: rect(".nextBtn"),
      previewArea: rect(".previewArea"),
      preview: rect(".pvBox"),
      previewTag: document.querySelector(".pvTag") ? rect(".pvTag") : null,
      previewCompact: document.querySelector(".pvBox")?.getAttribute("data-compact") === "true",
      tryButton: rect(".tryPill"),
      transport: rect(".transport"),
      timeline: rect(".tl"),
      toolbar: rect(".toolBar"),
      tools: rect(".tools"),
      toolButtons: [...document.querySelectorAll(".tools button")].map(button => {
        const { left, right } = button.getBoundingClientRect();
        return { label: button.getAttribute("aria-label"), left, right };
      }),
      scroll: {
        windowY: scrollY,
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
        rootOverflow: root.scrollHeight - root.clientHeight,
        appOverflow: app.scrollHeight - app.clientHeight,
        appTop: app.scrollTop,
      },
    };
  });
}

function assertEditorFits(layout, label) {
  const { visible, app, header, back, title, next, previewArea, preview, previewTag, previewCompact, tryButton, transport, timeline, toolbar, tools, toolButtons, scroll } = layout;
  assertInside(app, visible, `${label}: app`);
  for (const [name, element] of Object.entries({ header, previewArea, transport, timeline, toolbar })) {
    assertInside(element, visible, `${label}: ${name}`);
  }
  for (const [name, element] of Object.entries({ back, title, next })) {
    assertInside(element, header, `${label}: header ${name}`);
  }
  assertInside(preview, previewArea, `${label}: video preview`);
  const overlap = (a, b) => a.right > b.left + 1 && a.left < b.right - 1 &&
    a.bottom > b.top + 1 && a.top < b.bottom - 1;
  if (previewCompact) {
    assert.equal(previewTag, null, `${label}: the redundant badge should not cover a compact preview`);
    assertInside(tryButton, previewArea, `${label}: compact Try control`);
    assert(tryButton.left >= previewArea.left - 1 && tryButton.right <= previewArea.right + 1,
      `${label}: compact Try control escapes the preview region horizontally`);
    assert(tryButton.width >= 44 && tryButton.height >= 44, `${label}: compact Try needs a usable touch target`);
    assert(!overlap(preview, tryButton), `${label}: compact Try must sit beside the video, without covering it`);
  } else {
    assert(previewTag, `${label}: a large preview should retain its clip badge`);
    assert.ok(!overlap(previewTag, tryButton),
      `${label}: clip badge and Try button overlap: ${JSON.stringify({ previewTag, tryButton })}`);
  }
  assertInside(tools, toolbar, `${label}: bottom tools`);
  assert.equal(toolButtons.length, 5, `${label}: the main toolbar should have five tools`);
  for (const button of toolButtons) {
    assert.ok(button.left >= tools.left - 1 && button.right <= tools.right + 1,
      `${label}: ${button.label} is horizontally cut off: ${JSON.stringify({ button, tools })}`);
  }
  assert.ok(preview.height >= 100, `${label}: the video preview became unusably small: ${JSON.stringify(layout)}`);
  assert.ok(header.bottom <= previewArea.top + 1 && previewArea.bottom <= transport.top + 1 &&
    transport.bottom <= timeline.top + 1 && timeline.bottom <= toolbar.top + 1,
  `${label}: editor regions overlap: ${JSON.stringify(layout)}`);
  assert.ok(scroll.windowY === 0 && scroll.appTop === 0 &&
    scroll.documentOverflow <= 2 && scroll.bodyOverflow <= 2 &&
    scroll.rootOverflow <= 2 && scroll.appOverflow <= 2,
  `${label}: the whole editor must fit without vertical scrolling: ${JSON.stringify(layout)}`);
}

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(videoFile);
  await page.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.locator(".componentTypeTile").filter({ hasText: "Tooltip" }).click();
  await page.getByRole("dialog", { name: "Tooltip" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Collapse component tools" }).click();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('[data-notification-id]').count(), 0,
    "Creating a component should not display a notification");

  for (const [label, width, height] of [
    ["standard phone", 390, 844],
    ["short phone", 375, 667],
    ["resized phone", 390, 667],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    const layout = await inspect(page);
    assertEditorFits(layout, label);
    if (process.env.CAPTURE_SHOTS && label === "short phone") await page.screenshot({ path: process.env.CAPTURE_SHOTS });
  }
  // Chromium does not expose an iPhone notch inset; reserve equivalent space
  // to confirm the editor can still compress around iOS system controls.
  await page.addStyleTag({ content: ".editorHead{height:123px;padding-top:59px}.tools{padding-bottom:56px}" });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(350);
  assertEditorFits(await inspect(page), "short phone with simulated safe areas");
  assert.deepEqual(errors, [], "The editor should have no browser errors");
  console.log("Editor viewport fit passed: header, preview, transport, timeline and toolbar stay onscreen after phone resize.");
  await context.close();
} finally {
  await browser.close();
}
