import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const dark = "rgb(11, 11, 15)";
const desktopGround = "rgb(212, 207, 194)";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

async function inspect(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#root");
    const app = document.querySelector(".app");
    if (!root || !app) throw new Error("The editor root or app did not render");

    const rect = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      html: { ...rect(document.documentElement), background: getComputedStyle(document.documentElement).backgroundColor },
      body: { ...rect(document.body), background: getComputedStyle(document.body).backgroundColor },
      root: { ...rect(root), background: getComputedStyle(root).backgroundColor },
      app: { ...rect(app), background: getComputedStyle(app).backgroundColor },
    };
  });
}

function assertFullBleed(layout, label) {
  const { viewport, html, body, root, app } = layout;
  for (const [name, element] of Object.entries({ html, body, root, app })) {
    assert.equal(element.background, dark, `${label}: ${name} must cover exposed viewport space with the app color`);
    assert.ok(Math.abs(element.x) <= 1 && Math.abs(element.y) <= 1,
      `${label}: ${name} starts away from the viewport edge: ${JSON.stringify(layout)}`);
    assert.ok(Math.abs(element.right - viewport.width) <= 1 && Math.abs(element.bottom - viewport.height) <= 1,
      `${label}: ${name} leaves a viewport gap: ${JSON.stringify(layout)}`);
  }
}

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.locator("#root .app").waitFor();

  for (const [label, width, height] of [
    ["phone portrait", 390, 844],
    ["phone landscape", 844, 390],
    ["short wide phone", 640, 252],
  ]) {
    await page.setViewportSize({ width, height });
    assertFullBleed(await inspect(page), label);
  }
  await context.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(editorUrl, { waitUntil: "networkidle" });
  await desktop.locator("#root .app").waitFor();
  const layout = await inspect(desktop);
  for (const [name, element] of Object.entries({ html: layout.html, body: layout.body, root: layout.root })) {
    assert.equal(element.background, desktopGround, `desktop: ${name} should show the frame surround`);
  }
  assert.equal(layout.app.background, dark, "desktop: app should retain its dark background");
  assert.ok(layout.app.x > 0 && layout.app.y > 0 &&
    layout.app.right < layout.viewport.width && layout.app.bottom < layout.viewport.height,
  `desktop: the app should be framed within the viewport: ${JSON.stringify(layout)}`);
  await desktop.close();

  console.log("Editor viewport backgrounds passed: phone portrait, landscape, short landscape, and desktop frame.");
} finally {
  await browser.close();
}
