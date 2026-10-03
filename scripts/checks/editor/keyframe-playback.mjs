import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright-core";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const media = await readFile(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = process.env.BROWSER === "webkit"
  ? await webkit.launch({ headless: true })
  : await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(12000);

async function seek(time) {
  await page.evaluate(time => window.keyframePlayback.useCapture.getState().patch({ t: time, playing: false }), time);
  await page.waitForFunction(time => {
    const video = document.querySelector(".pvVideo");
    return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < .04;
  }, time);
}

async function assertPlayback(label, start = () => page.getByRole("button", { name: "Play", exact: true }).click(),
  stop = () => page.getByRole("button", { name: "Pause", exact: true }).click()) {
  const animation = await page.evaluate(() => window.keyframePlayback.useCapture.getState().components[0].animation);
  await page.evaluate(() => {
    const video = document.querySelector(".pvVideo");
    const observation = { initialTime: video.currentTime, frames: [] };
    window.keyframePlayback.observation = observation;
    const frame = (now, metadata) => {
      if (window.keyframePlayback.observation !== observation) return;
      observation.frames.push(metadata.mediaTime);
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  });
  await start();
  try {
    await page.waitForFunction(() => {
      const { useCapture, observation } = window.keyframePlayback;
      const video = document.querySelector(".pvVideo");
      return useCapture.getState().playing && !video.paused && !video.seeking
        && video.currentTime > observation.initialTime + .6
        && useCapture.getState().t > observation.initialTime + .5
        && observation.frames.filter(time => time > observation.initialTime + .1).length >= 8;
    }, null, { timeout: 5000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      time: window.keyframePlayback.useCapture.getState().t,
      playing: window.keyframePlayback.useCapture.getState().playing,
      mediaTime: document.querySelector(".pvVideo")?.currentTime,
      paused: document.querySelector(".pvVideo")?.paused,
      observation: window.keyframePlayback.observation,
    }));
    throw new Error(`${label}: real decoded playback did not advance: ${JSON.stringify(snapshot)}`, { cause: error });
  }
  const snapshot = await page.evaluate(() => ({
    time: window.keyframePlayback.useCapture.getState().t,
    mediaTime: document.querySelector(".pvVideo").currentTime,
    frames: window.keyframePlayback.observation.frames.length,
  }));
  assert(Math.abs(snapshot.time - snapshot.mediaTime) < .15, `${label}: video and playhead stay synchronized`);
  await stop();
  assert.deepEqual(await page.evaluate(() => window.keyframePlayback.useCapture.getState().components[0].animation), animation,
    `${label}: playback does not edit or delete component keyframes`);
  console.log(`${label}: ${JSON.stringify(snapshot)}`);
}

try {
  await page.route("**/keyframe-playback.mp4", route => route.fulfill({ body: media, contentType: "video/mp4" }));
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Blank project", exact: true }).click();
  await page.locator("[data-desktop-player]").waitFor();
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/store.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    useCapture.setState(initial());
    const url = URL.createObjectURL(await (await fetch("/keyframe-playback.mp4")).blob());
    const clip = { id: 1, url, color: "#000", srcDur: 7.9, in: 0, out: 7.9, speed: 1,
      zoom: 1, mirror: false, width: 720, height: 1280, fit: "contain" };
    useCapture.getState().patch({ screen: "editor", clips: [clip], t: 0, muted: true, sel: -1, sheet: null });
    const componentId = useCapture.getState().addComponent("tooltip");
    useCapture.getState().updateComponent(componentId, { at: 0, dur: 7.9, x: 50, y: 65 });
    useCapture.getState().patch({ sel: -1, selComp: componentId, sheet: "component", past: [], future: [] });
    window.keyframePlayback = { useCapture, componentId };
    const { navigateProject } = await import("/src/app/navigation.ts");
    const projectId = crypto.randomUUID();
    useCapture.getState().patch({ localId: projectId });
    navigateProject(projectId, true);
  });
  await seek(0);
  await assertPlayback("Desktop before keyframes");
  await page.getByRole("tab", { name: "Look", exact: true }).click();
  const inspector = page.locator("[data-keyframe-editor]").filter({ visible: true });
  await seek(.5);
  await inspector.getByRole("button", { name: "Add Scale keyframe", exact: true }).click();
  await assertPlayback("Desktop Space after adding a component keyframe", () => page.keyboard.press("Space"));
  await seek(2);
  await inspector.getByRole("button", { name: "Add Scale keyframe", exact: true }).click();
  await inspector.getByRole("slider", { name: "Scale", exact: true }).focus();
  await inspector.getByRole("slider", { name: "Scale", exact: true }).press("End");
  await assertPlayback("Desktop with selected component keyframe");
  await seek(.5);
  await page.locator('[data-keyframe-lane="scale"]').getByRole("button", { name: "Scale keyframe at 0:00.5", exact: true }).click();
  await assertPlayback("Desktop after timeline key selection");
  await page.locator('[data-keyframe-lane="scale"]').getByRole("button", { name: "Scale keyframe at 0:00.5", exact: true }).click();
  await assertPlayback("Desktop Space after selecting a component keyframe", () => page.keyboard.press("Space"));
  await seek(.75);
  const opacityDiamond = inspector.getByRole("button", { name: "Add Opacity keyframe", exact: true });
  await opacityDiamond.focus();
  await opacityDiamond.press("Enter");
  assert.equal(await page.evaluate(() => window.keyframePlayback.useCapture.getState().components[0].animation.tracks.opacity[0].time), .75,
    "Enter still activates a focused property diamond");
  await inspector.getByRole("button", { name: "Jump", exact: true }).click();
  await assertPlayback("Desktop Space after setting keyframe easing", () => page.keyboard.press("Space"));
  const safeZone = page.getByRole("button", { name: "Safe zone", exact: true });
  const previousSafeZone = await safeZone.getAttribute("aria-pressed");
  await safeZone.focus();
  await safeZone.press("Space");
  assert.notEqual(await safeZone.getAttribute("aria-pressed"), previousSafeZone,
    "Space retains normal activation on an unrelated button");
  assert.equal(await page.evaluate(() => window.keyframePlayback.useCapture.getState().playing), false,
    "Space on an ordinary button does not start playback");
  await seek(1.5);
  await page.getByRole("button", { name: "Add keyframe at 0:01.5 · K", exact: true }).click();
  await assertPlayback("Desktop Space after timeline Add keyframe", () => page.keyboard.press("Space"));
  await seek(0);
  await assertPlayback("Try with animated component",
    () => page.getByRole("button", { name: "Try", exact: true }).click(),
    () => page.getByRole("button", { name: "Stop trying", exact: true }).click());

  await page.setViewportSize({ width: 390, height: 844 });
  await seek(1);
  await page.getByRole("button", { name: "◆ Animate", exact: true }).click();
  const sheet = page.locator("[data-animation-sheet]");
  await sheet.getByRole("button", { name: "Keyframe", exact: true }).click();
  await assertPlayback("Phone with Animate open");
  await sheet.getByRole("button", { name: "Keyframe at 0:01.0", exact: true }).click();
  await assertPlayback("Phone Space after ribbon key selection", () => page.keyboard.press("Space"));
  await sheet.getByRole("button", { name: "Close Animate", exact: true }).click();
  await seek(.5);
  await assertPlayback("Phone after closing Animate");
  assert.deepEqual(errors, [], "Keyframe playback has no browser runtime errors");
  console.log("PASS: component keyframes retain real decoded playback through desktop and phone authoring.");
} catch (error) {
  console.error("Keyframe playback diagnostics", { errors, body: (await page.locator("body").innerText()).slice(0, 5000) });
  await page.screenshot({ path: "/tmp/keyframe-playback-failure.png" });
  throw error;
} finally {
  await browser.close();
}
