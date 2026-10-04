import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { packPvoProject, PVO_SPEC_VERSION } from "../../../packages/pvo-sdk/index.js";
import { playerSourceAssets } from "../helpers/player-assets.mjs";

const assets = await playerSourceAssets();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  const asset = assets.get(path);
  if (!asset) { response.writeHead(404).end("Not found"); return; }
  response.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
  response.end(asset.body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const playerUrl = process.env.PVO_PLAYER_URL || `http://127.0.0.1:${server.address().port}/player/`;
const videos = {
  portrait: await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url)),
  landscape: await readFile(new URL("../../../assets/pvo-demo.mp4", import.meta.url)),
};
const screenshots = process.env.PVO_PLAYER_ARTIFACTS;
if (screenshots) await mkdir(screenshots, { recursive: true });

async function fixture({ component = false, top = false, landscape = false, layered = false } = {}) {
  const duration = component ? 2 : 6;
  const behindTexts = Array.from({ length: 7 }, (_, index) => ({
    id: `behind-${index}`, text: "Behind footage", x: 50, y: 50, start: 0, end: duration,
  }));
  const manifest = {
    spec_version: PVO_SPEC_VERSION,
    initial_scene: "main",
    canvas: landscape ? { ratio: "16:9", width: 16, height: 9 } : { ratio: "9:16", width: 9, height: 16 },
    restyle_capture: { version: 1, ...(layered ? { scene_layers: { main: {
      order: [...behindTexts.map(text => `text:${text.id}`), "video", "text:caption", "component:choice"],
      texts: [...behindTexts, { id: "caption", text: "Summer", x: 50, y: 50, start: 0, end: duration }],
    } } } : {}) },
    media: [{ id: "main", asset_id: "video", name: "media/video.mp4", type: "video/mp4" }],
    scenes: [{ id: "main", label: "A summer story", asset_id: "video", start: 0, end: duration }],
    playback: { initial_timeline: "main", timelines: [{ id: "main", kind: "main",
      clips: [{ id: "clip", scene: "main", asset_id: "video", start: 0, end: duration }] }] },
    components: component ? [{
      id: "choice", kind: "choice", title: landscape ? "Where next?" : "Where should we go next?",
      response_policy: { dispatch: "interaction", unanswered: "pause" },
      presentation: { scene: "main", start: .25, end: .3, x: .1, y: top ? .02 : .75, width: .8, height: .2 },
      options: [
        { label: "The beach", action: { type: "custom", name: "restyle_continue" } },
        { label: "The city", action: { type: "custom", name: "restyle_continue" } },
      ],
      restyle_capture: { version: 1, at: .25, dur: null, x: 50, y: top ? 12 : 84,
        outcomes: [{ kind: "continue" }, { kind: "continue" }] },
    }] : [],
  };
  return Buffer.from(await (await packPvoProject({ manifest,
    assets: [{ id: "video", name: "media/video.mp4", blob: new Blob([landscape ? videos.landscape : videos.portrait], { type: "video/mp4" }) }],
  })).arrayBuffer());
}

const packages = {
  plain: await fixture(),
  bottom: await fixture({ component: true }),
  top: await fixture({ component: true, top: true }),
  landscape: await fixture({ component: true, landscape: true }),
  layered: await fixture({ component: true, top: true, layered: true }),
};
const devices = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 834, height: 1194 },
  { name: "tablet-landscape", width: 1194, height: 834 },
  { name: "desktop", width: 1280, height: 800 },
];

async function openPackage(page, name, query = {}) {
  const url = new URL(playerUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.locator("#pvoInput").setInputFiles({ name: `${name}.pvo`, mimeType: "application/vnd.pvo", buffer: packages[name] });
  await page.locator('#video[data-asset-id="video"]').waitFor();
  await page.waitForFunction(() => document.querySelector("#video").readyState >= 2);
  // Give the chrome assertions time on busy CI machines without replaying a
  // completed fixture; the response-boundary cases keep their normal clock.
  if (name === "plain") await page.locator("#video").evaluate(video => { video.playbackRate = .25; });
}

async function screenshot(page, name) {
  if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true, animations: "disabled" });
}

function intersects(first, second) {
  return first.x < second.x + second.width && first.x + first.width > second.x
    && first.y < second.y + second.height && first.y + first.height > second.y;
}

async function assertUnobstructed(page, description) {
  const buttons = await page.locator("pvo-component-view button").all();
  const stage = await page.locator("#playerFrame").boundingBox();
  assert.ok(buttons.length >= 2, `${description}: component buttons missing`);
  for (const button of buttons) {
    const target = await button.boundingBox();
    assert.ok(target && target.width >= 40 && target.height >= 40,
      `${description}: component button must retain a 40px target: ${JSON.stringify(target)}`);
    assert.ok(target.x >= stage.x - 1 && target.y >= stage.y - 1
      && target.x + target.width <= stage.x + stage.width + 1
      && target.y + target.height <= stage.y + stage.height + 1,
    `${description}: component button must be fully reachable inside the stage: ${JSON.stringify({ target, stage })}`);
    for (const selector of ["#statusWidget", "#brandSticker", "#centerPlayButton", "#endRestartButton"]) {
      const sticker = page.locator(selector);
      if (await sticker.isVisible()) {
        assert.equal(intersects(target, await sticker.boundingBox()), false,
          `${description}: ${selector} overlaps ${await button.textContent()}`);
      }
    }
  }
}

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, args: ["--no-sandbox"] });
  for (const theme of ["light", "dark"]) {
    for (const device of devices) {
      const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, colorScheme: theme });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
      const label = `${theme}-${device.name}`;
      await openPackage(page, "plain");
      await screenshot(page, `${label}-autoplay`);
      assert.equal(await page.locator("#muteButton").evaluate(element => getComputedStyle(element).backgroundColor),
        theme === "light" ? "rgb(242, 240, 233)" : "rgb(28, 27, 34)", `${label}: sticker theme`);
      const colours = await page.locator(".create-button, #brandCreateLink").evaluateAll(elements =>
        elements.map(element => getComputedStyle(element).backgroundColor));
      assert.equal(new Set(colours).size, 1, `${label}: all Create links share the visit colour`);
      assert.ok(["rgb(255, 138, 0)", "rgb(0, 229, 160)", "rgb(0, 212, 255)", "rgb(139, 45, 255)",
        "rgb(255, 45, 120)", "rgb(61, 90, 254)"].includes(colours[0]), `${label}: approved CTA accent`);
      assert.equal(await page.locator("#playerControls, #progress, #volumeControl, #restartButton, #fullscreenButton").count(), 0);
      assert.equal(await page.locator("#video").evaluate(element => element.controls), false);
      assert.equal(await page.locator("#video").evaluate(element => element.muted), true);
      await page.locator("#muteButton").click();
      assert.equal(await page.locator("#video").evaluate(element => element.muted), false);
      assert.equal(await page.locator("#muteButton").getAttribute("aria-label"), "Mute");
      await page.keyboard.press("m");
      assert.equal(await page.locator("#video").evaluate(element => element.muted), true);
      if (!await page.locator("#video").evaluate(element => element.paused)) await page.locator("#video").click();
      await page.locator("#centerPlayButton").waitFor({ state: "visible" });
      await screenshot(page, `${label}-paused`);
      assert.equal(await page.locator(".create-button").first().evaluate(element => getComputedStyle(element).backgroundColor), colours[0]);
      await page.locator("#centerPlayButton").click();
      await page.waitForFunction(() => !document.querySelector("#video").paused);
      await page.locator("#centerPlayButton").waitFor({ state: "hidden" });
      await screenshot(page, `${label}-playing`);

      for (const position of ["bottom", "top"]) {
        await openPackage(page, position);
        await page.locator("#holdStatus").waitFor({ state: "visible" });
        assert.match(await page.locator("#holdStatus").textContent(), /Choose to continue/);
        assert.equal(await page.locator("#centerPlayButton").isVisible(), false);
        await assertUnobstructed(page, `${label}-${position}`);
        const heldTime = await page.locator("#video").evaluate(element => element.currentTime);
        await page.locator("#video").click();
        await page.keyboard.press("Space");
        await page.keyboard.press("k");
        await page.waitForTimeout(180);
        assert.equal(await page.locator("#video").evaluate(element => element.paused), true,
          "A held answer cannot be bypassed by footage or keyboard playback controls");
        assert.ok(Math.abs(await page.locator("#video").evaluate(element => element.currentTime) - heldTime) < .05);
        await screenshot(page, `${label}-${position}-held`);
        await page.locator("pvo-component-view").getByRole("button", { name: "The beach", exact: true }).click();
        await page.locator("#endScreen").waitFor({ state: "visible", timeout: 10000 });
        await page.locator("#endRestartButton").click();
        await page.locator("#holdStatus").waitFor({ state: "visible" });
        assert.equal(await page.locator("#endScreen").isVisible(), false);
      }
      assert.deepEqual(errors, [], `${label}: browser errors`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false,
        `${label}: player should fit the viewport width`);
      await context.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openPackage(page, "landscape");
  await page.locator("#holdStatus").waitFor({ state: "visible" });
  await assertUnobstructed(page, "phone-landscape-footage");
  await screenshot(page, "light-phone-landscape-footage-held");
  assert.equal(await page.locator('.component-position[data-lifted="below"]').count(), 1,
    "A landscape component lifts into the free space below the footage.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openPackage(page, "layered", { debugHits: "1" });
  await page.locator("#holdStatus").waitFor({ state: "visible" });
  await assertUnobstructed(page, "layered-video");
  assert.equal(await page.locator(".capture-text").count(), 8,
    "Lower text remains mounted so animated footage can reveal its authored layer.");
  assert.equal(await page.locator("#statusWidget").evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, "The status widget remains in front of footage even when video has a high authored layer index.");
  assert.equal(await page.locator("#brandSticker").evaluate(element => getComputedStyle(element).transitionDuration), "0s");
  const choiceButton = page.locator("pvo-component-view").getByRole("button", { name: "The beach", exact: true });
  await page.keyboard.press("Tab");
  await choiceButton.focus();
  const focus = await choiceButton.evaluate(element => ({
    outline: getComputedStyle(element).outlineColor,
    debug: getComputedStyle(element).boxShadow,
  }));
  assert.equal(focus.outline, "rgb(255, 210, 62)", "Focused component controls retain their visible keyboard ring.");
  assert.match(focus.debug, /rgba\(0, 229, 160, 0\.3\).*inset/, "debugHits paints the component's tap target.");
  await screenshot(page, "light-phone-layered-debug-focus");
  await choiceButton.click();
  await page.locator("#endScreen").waitFor({ state: "visible", timeout: 10000 });
  console.log("Restyle player passed: responsive light/dark chrome, sound, footage/keyboard playback, held answers, unobstructed component targets, and replay.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
