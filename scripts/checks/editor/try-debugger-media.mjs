import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Public-UI check: also works against built beta output. Uses its existing sample.
const home = new URL(process.env.EDITOR_URL || "http://127.0.0.1:5173/");
home.search = "?home=1";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(home.href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use Choose your path template", exact: true }).click();
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector(".pvVideo");
    return video?.paused && video.currentTime > 5.9;
  });
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  await page.getByText("Paused — waiting for Choose your path", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Copy report", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Copy report", exact: true });
  const box = await report.boundingBox();
  assert(box && box.y >= 0 && box.x >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900);
  assert.equal(await report.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + 20);
    return element.contains(hit);
  }), true, "The upward report preview must not be clipped by the dock");
  const evidence = JSON.parse(await report.locator("pre").innerText());
  assert(evidence.records.some(record => record.type === "media.paused"), "Final-frame hold must observe the native video pause");
  assert.equal(evidence.records[0].videoTime, 0);
  await page.keyboard.press("Escape");
  await report.waitFor({ state: "hidden" });
  assert.equal(await page.locator("[data-debug-dock]").count(), 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-debug-sheet]").waitFor();
  await page.getByText("Paused — waiting for Choose your path", { exact: true }).waitFor();
  await page.getByRole("option").filter({ hasText: "Held" }).click();
  await page.getByText(/^Playback · at /).waitFor();
  assert.equal(await page.getByText(/tap at/).count(), 0, "A hold without input must not claim a tap occurred");
  await page.getByRole("button", { name: "Locate", exact: true }).click();
  await page.locator("[data-debug-locate]").waitFor();
  const pausedTime = await page.locator(".pvVideo").evaluate(video => video.currentTime);
  assert(pausedTime > 5.9, "Locate must not seek or restart playback");
  await page.getByRole("button", { name: "Stop and edit →", exact: true }).click();
  await page.getByRole("button", { name: "Try", exact: true }).waitFor();
  assert.equal(await page.locator("[data-debug-sheet]").count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Action", exact: true }).getAttribute("aria-selected"), "true");
  assert.deepEqual(errors, []);
  console.log("Try debugger media passed: native final-frame pause, visible desktop report, retained run across rotation, read-only Locate, Stop and edit.");
} finally {
  await browser.close();
}
