import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { finishAssistantVerification } from "./assistant-fixture.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = [];
const requests = [], verifications = [];
page.on("pageerror", error => errors.push(error.message));
const preview = page.locator(".pvBox");
const input = page.getByRole("textbox", { name: "Describe a change", exact: true });
const snapshot = () => page.evaluate(async () => {
  const { projectSnapshot } = await import("/src/state/project/history.ts");
  const state = window.previewCapture.getState();
  return JSON.stringify({ project: projectSnapshot(state), past: state.past, future: state.future, t: state.t });
});
const sourceTime = async time => {
  try {
    await page.waitForFunction(time => {
      const video = document.querySelector(".pvVideo");
      return video && video.readyState >= 2 && !video.seeking && video.paused && Math.abs(video.currentTime - time) < 0.03;
    }, time);
  } catch (error) {
    const actual = await page.evaluate(() => {
      const video = document.querySelector(".pvVideo");
      return { media: video && { time: video.currentTime, ready: video.readyState, seeking: video.seeking, paused: video.paused, error: video.error?.message },
        stateTime: window.previewCapture?.getState().t, count: document.querySelectorAll(".pvVideo").length };
    });
    throw new Error(`Expected paused source time ${time}: ${JSON.stringify(actual)}; page errors: ${errors.join("; ")}`, { cause: error });
  }
};

try {
  await page.route("**/api/assistant/turn", async route => {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    if (await finishAssistantVerification(route, request)) {
      verifications.push(request);
      return;
    }
    requests.push(request);
    const scene = request.project.scenes[0];
    await route.fulfill({ json: {
      message: "Add the title, tighten the opening, move the note and use a square canvas.", observations: [],
      operations: [
        { kind: "text.add", sceneId: scene.id, text: "Summer sale", start: 0, end: 3 },
        { kind: "clip.trim", sceneId: scene.id, clipId: scene.clips[0].id, sourceIn: 1, sourceOut: scene.clips[0].sourceOut },
        { kind: "clip.update", sceneId: scene.id, clipId: scene.clips[0].id, changes: { speed: 2 } },
        { kind: "component.update", sceneId: scene.id, componentId: scene.components[0].id, changes: { x: 35 } },
        { kind: "project.ratio", ratio: "1:1" },
      ],
    } });
  });
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5195/", { waitUntil: "networkidle" });
  await page.evaluate(async root => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { readVideoMetadata } = await import("/src/infrastructure/media/readVideo.ts");
    window.previewCapture = useCapture;
    useCapture.setState(initial());
    const response = await fetch(`/@fs/${root}share/assets/preview.mp4`);
    if (!response.ok) throw new Error("The real sample video is unavailable.");
    const url = URL.createObjectURL(await response.blob());
    const metadata = await readVideoMetadata(url);
    const clip = { id: 1, url, srcDur: metadata.duration, in: 0, out: Math.min(8, metadata.duration), speed: 1,
      color: "#442244", zoom: 1, mirror: false, width: metadata.width, height: metadata.height, fit: "contain" };
    useCapture.getState().patch({ screen: "editor", clips: [clip], ratio: "16:9", t: 0.5, playing: false, sound: 0 });
    useCapture.getState().addComponent("tooltip");
    useCapture.getState().patch({ selComp: null, sheet: null, t: 0.5, past: [], future: [] });
  }, root);
  await preview.waitFor();
  await sourceTime(0.5);
  const original = await snapshot();
  await page.locator("[data-assistant-orb]").click();
  await input.fill("Add a title, trim and speed the opening, move the note, make it square");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.locator('[data-notification-id="assistantApplied"]').waitFor();
  await page.getByRole("button", { name: "Edit text: Summer sale", exact: true }).waitFor();
  await sourceTime(2);
  await page.waitForFunction(() => {
    const box = document.querySelector(".pvBox").getBoundingClientRect();
    return Math.abs(box.width / box.height - 1) < 0.02;
  });
  const proposedBounds = await preview.boundingBox();
  assert(Math.abs(proposedBounds.width / proposedBounds.height - 1) < 0.02, `Applied ratio should render: ${JSON.stringify(proposedBounds)}`);
  assert.notEqual(await snapshot(), original, "Applied changes immediately update the actual project");
  assert.equal(await page.locator('[data-assistant-phase="idle"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: "Keep", exact: true }).count(), 0);
  const kept = await page.evaluate(() => {
    const state = window.previewCapture.getState();
    return { text: state.texts[0].text, sourceIn: state.clips[0].in, speed: state.clips[0].speed,
      x: state.components[0].x, ratio: state.ratio, past: state.past.length };
  });
  assert.deepEqual(kept, { text: "Summer sale", sourceIn: 1, speed: 2, x: 35, ratio: "1:1", past: 1 });
  assert.equal(requests.length, 1);
  assert.equal(verifications.length, 1);
  assert.equal(verifications[0].project.ratio, "1:1", "Completion sees the candidate ratio");
  assert.equal(verifications[0].project.scenes[0].texts[0].text, "Summer sale", "Completion sees the candidate text");
  await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true }).click();
  await sourceTime(0.5);
  assert.equal(await page.getByRole("button", { name: "Edit text: Summer sale", exact: true }).count(), 0);
  const undone = await page.evaluate(() => {
    const state = window.previewCapture.getState();
    return { textCount: state.texts.length, sourceIn: state.clips[0].in, speed: state.clips[0].speed, ratio: state.ratio, past: state.past.length };
  });
  assert.deepEqual(undone, { textCount: 0, sourceIn: 0, speed: 1, ratio: "16:9", past: 0 });
  assert.deepEqual(errors, []);
  console.log("Native preview: handoff orb, actual applied video trim/speed decode, text/component/ratio rendering, atomic commit and Undo passed.");
} finally { await browser.close(); }
