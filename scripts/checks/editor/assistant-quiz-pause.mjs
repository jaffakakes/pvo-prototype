import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture, preparedAssistantReceipts } from "./assistant-fixture.mjs";

// Only inference replies are fixtures. This uses the real compiler, native batch,
// media clock, Try hold and viewer button rather than calling runtime commands.
const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const boundary = 2;
const punchlineStarts = 2.051;
const question = "What does he want instead of peace?";
const answer = "I want problems, always.";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await installAssistantAvailabilityFixture(page);
page.setDefaultTimeout(15000);
const errors = [];
const calls = [];
page.on("pageerror", error => errors.push(error.message));
const snapshot = () => page.evaluate(() => {
  const state = window.quizPauseStore.getState();
  const video = document.querySelector(".pvVideo");
  return { scene: structuredClone(state.scenes[0]), t: state.t, past: state.past.length,
    playing: state.playing, holdingId: state.tryMode?.holdingId ?? null,
    video: video ? { time: video.currentTime, paused: video.paused, seeking: video.seeking } : null };
});
let scenario;
await page.route("**/api/assistant/turn", async route => {
  try {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    calls.push(request);
    const receipts = preparedAssistantReceipts(request);
    const scene = request.project.scenes[0];
    let operations = [];
    if (!receipts.length) {
      operations = scenario === "create"
        ? [{ kind: "component.add", sceneId: scene.id, componentType: "choice", at: 0, duration: 2,
          responsePolicy: { dispatch: "layer_end", unanswered: "pause" } }]
        : [{ kind: "component.update", sceneId: scene.id, componentId: scene.components[0].id,
          changes: { at: 1.5, duration: 0.5, responsePolicy: { dispatch: "interaction", unanswered: "pause" } } }];
    } else if (scenario === "create" && receipts.length === 1) {
      assert.deepEqual(scene.components[0].responsePolicy, { dispatch: "layer_end", unanswered: "pause" },
        "The next model turn sees the actual prepared hold policy");
      operations = [{ kind: "component.content", sceneId: scene.id, componentId: scene.components[0].id,
        changes: { prompt: question, optionLabels: [answer, "I want a quiet day."] } }];
    } else {
      const choice = scene.components[0];
      assert.equal(choice.at + choice.duration, boundary);
      assert.equal(choice.responsePolicy.unanswered, "pause");
    }
    await route.fulfill({ json: parseNativeTurnResult({ message: operations.length ? "Prepare the timed quiz." : "The quiz will wait for a guess before the punchline.",
      operations, observations: [] }) });
  } catch (error) {
    errors.push(String(error));
    await route.fulfill({ status: 500, json: { error: "Fixture validation failed." } });
  }
});

async function requestQuiz(prompt) {
  await page.locator("[data-assistant-orb]").click();
  await page.getByRole("textbox", { name: "Describe a change", exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const notice = page.locator('[data-notification-id="assistantApplied"]');
  await notice.waitFor();
  await notice.getByRole("button", { name: "Dismiss notification", exact: true }).click();
}

async function verifyViewerHold(label) {
  const authored = await snapshot();
  const id = authored.scene.components[0].id;
  assert.equal(authored.scene.components[0].at + authored.scene.components[0].dur, boundary);
  assert.equal(authored.scene.components[0].responsePolicy.unanswered, "pause");
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.waitForFunction(({ id, boundary }) => {
    const state = window.quizPauseStore.getState();
    const video = document.querySelector(".pvVideo");
    return state.tryMode?.holdingId === id && !state.playing && Math.abs(state.t - boundary) < 0.001
      && video?.paused && !video.seeking && Math.abs(video.currentTime - boundary) < 0.02;
  }, { id, boundary });
  const held = await snapshot();
  assert(held.video.time < punchlineStarts, `${label}: the paused media frame precedes the spoken punchline`);
  const pausedSourceTime = await page.evaluate(() => window.quizPauseSourceTimes.at(-1));
  assert(typeof pausedSourceTime === "number" && pausedSourceTime < punchlineStarts,
    `${label}: native playback must pause before the punchline, before any corrective seek (${pausedSourceTime}s)`);
  const choice = page.locator(`[data-preview-component="${id}"]`);
  await choice.getByText(question, { exact: true }).waitFor();
  await page.waitForTimeout(600); // Prove the hold survives elapsed media frames, not just a transient pause.
  const stillHeld = await snapshot();
  assert.equal(stillHeld.holdingId, id);
  assert.equal(stillHeld.playing, false);
  assert.equal(stillHeld.video.paused, true);
  assert(Math.abs(stillHeld.video.time - held.video.time) < 0.005, `${label}: media remains at the question while unanswered`);
  await choice.getByRole("button", { name: answer, exact: true }).click();
  await page.waitForFunction(boundary => {
    const state = window.quizPauseStore.getState();
    const video = document.querySelector(".pvVideo");
    return state.tryMode && state.tryMode.holdingId === null && state.playing
      && video && !video.paused && video.currentTime > boundary + 0.3;
  }, boundary);
  const resumed = await snapshot();
  assert.equal(resumed.past, authored.past, "Viewer answers do not alter project edit history");
  assert.deepEqual(resumed.scene, authored.scene, "Viewer answers preserve the authored quiz and footage");
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  await page.getByRole("button", { name: "Try", exact: true }).waitFor();
  assert.equal((await snapshot()).t, authored.t, "Stop restores the original editing playhead");
}

async function verifyEarlyAnswer() {
  const authored = await snapshot();
  const id = authored.scene.components[0].id;
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await page.locator(`[data-preview-component="${id}"]`).getByRole("button", { name: answer, exact: true }).click();
  const early = await page.evaluate(id => {
    const state = window.quizPauseStore.getState();
    return { t: state.t, playing: state.playing, captured: Boolean(state.tryMode?.capturedResponses[id]),
      dispatched: state.tryMode?.dispatched.includes(id), holdingId: state.tryMode?.holdingId };
  }, id);
  assert(early.t < boundary, "The viewer can answer before reaching the pause boundary");
  assert.equal(early.captured, true);
  assert.equal(early.dispatched, false, "Layer-end dispatch retains the early answer until the authored boundary");
  assert.equal(early.playing, true);
  assert.equal(early.holdingId, null);
  await page.waitForFunction(({ id, boundary }) => {
    const state = window.quizPauseStore.getState();
    return state.tryMode?.dispatched.includes(id) && state.playing && state.tryMode.holdingId === null && state.t > boundary + 0.3;
  }, { id, boundary });
  await page.getByRole("button", { name: "Stop trying", exact: true }).click();
  assert.deepEqual((await snapshot()).scene, authored.scene);
  assert.equal((await snapshot()).past, authored.past);
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5196/", { waitUntil: "networkidle" });
  await page.evaluate(async root => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { readVideoMetadata } = await import("/src/infrastructure/media/readVideo.ts");
    window.quizPauseStore = useCapture;
    window.quizPauseSourceTimes = [];
    const pauseMedia = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...args) {
      if (this.matches(".pvVideo") && !this.paused && useCapture.getState().tryMode?.holdingId)
        window.quizPauseSourceTimes.push(this.currentTime);
      return pauseMedia.apply(this, args);
    };
    useCapture.setState(initial());
    const response = await fetch(`/@fs/${root}share/assets/preview.mp4`);
    if (!response.ok) throw new Error("The sample video is unavailable.");
    const url = URL.createObjectURL(await response.blob());
    const metadata = await readVideoMetadata(url);
    if (metadata.duration < 4) throw new Error("The media fixture must continue after the quiz boundary.");
    const clip = { id: 1, url, srcDur: metadata.duration, in: 0, out: Math.min(8, metadata.duration), speed: 1,
      color: "#442244", zoom: 1, mirror: false, width: metadata.width, height: metadata.height, fit: "contain" };
    useCapture.getState().patch({ screen: "editor", clips: [clip], ratio: "16:9", t: 0, playing: false, sound: 0 });
  }, root);
  const original = await snapshot();
  scenario = "create";
  await requestQuiz("Add a quiz that pauses before the punchline and waits for my answer.");
  const created = await snapshot();
  assert.equal(created.past, original.past + 1, "Creation, policy and wording commit as one request");
  assert.deepEqual(created.scene.clips, original.scene.clips);
  await verifyViewerHold("desktop creation");
  await verifyEarlyAnswer();

  await page.evaluate(() => {
    const state = window.quizPauseStore.getState();
    state.updateComponent(state.components[0].id, {
      at: 0, dur: 5, responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    });
  });
  const beforeCorrection = await snapshot();
  assert.equal(beforeCorrection.scene.components[0].responsePolicy.unanswered, "continue");
  await page.setViewportSize({ width: 390, height: 844 });
  scenario = "update";
  await requestQuiz("Make the existing quiz pause at two seconds until I guess, then resume immediately.");
  const corrected = await snapshot();
  assert.equal(corrected.past, beforeCorrection.past + 1);
  assert.deepEqual(corrected.scene.clips, original.scene.clips);
  assert.equal(corrected.scene.components[0].id, created.scene.components[0].id);
  assert.deepEqual(corrected.scene.components[0].responsePolicy, { dispatch: "interaction", unanswered: "pause" });
  await verifyViewerHold("mobile correction");
  assert.equal(calls.length, 5);
  assert.deepEqual(errors, []);
  console.log("PASS native quiz policy: desktop creation and mobile correction pause real media before the punchline, hold unanswered, resume on a real choice click, accept an early answer, and preserve project/history. Model responses are fixtures.");
} catch (error) {
  console.error("Quiz pause state:", JSON.stringify(await snapshot().catch(() => null)));
  console.error("Quiz pause errors:", errors);
  await page.screenshot({ path: "/tmp/pvo-assistant-quiz-pause-failure.png" });
  throw error;
} finally {
  await browser.close();
}
