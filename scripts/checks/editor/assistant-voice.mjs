import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { parseTranscriptionAudio } from "../../../server/assistant/native/audio.js";
import { installAssistantFixture } from "./assistant-fixture.mjs";

const editorUrl = process.env.EDITOR_URL || process.env.RESTYLE_EDITOR_URL || "http://127.0.0.1:5173/";
const videoFile = fileURLToPath(new URL("../../../share/assets/preview.mp4", import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
const assistantFixture = await installAssistantFixture(context);
const uploads = [];
let response = { text: "Softer colours", hold: false, status: 200 };
let pendingResponse;
await context.route("**/api/assistant/transcribe", async route => {
  const request = route.request();
  const bytes = request.postDataBuffer();
  const { duration } = parseTranscriptionAudio(bytes);
  assert.equal(request.headers()["content-type"], "audio/wav");
  assert(Math.abs(Number(request.headers()["x-audio-duration"]) - duration) < 0.001);
  assert(duration > 0 && duration <= 60);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.byteLength - 44) / 2);
  assert(samples.some(value => Math.abs(value) > 100), "The real recorder and WAV decoder must preserve the synthetic signal");
  uploads.push({ duration, bytes: bytes.byteLength });
  const chosen = response;
  if (chosen.hold) await new Promise(resolve => { pendingResponse = resolve; });
  await route.fulfill({ status: chosen.status, json: chosen.status === 200
    ? { text: chosen.text, segments: [] } : { code: "provider_allowance_exhausted" } }).catch(() => {});
});

// Only the permission/device boundary and HTTP provider are fixtures. MediaRecorder,
// container encoding, OfflineAudioContext decoding, WAV conversion and gestures are real.
await context.addInitScript(() => {
  const state = { requests: 0, active: 0, stops: 0, auto: true, pending: null, recorders: [] };
  const Recorder = window.MediaRecorder;
  window.MediaRecorder = class extends Recorder {
    start(...args) { state.recorders.push(this); super.start(...args); }
  };
  state.approve = async () => {
    const waiting = state.pending;
    state.pending = null;
    const audio = new AudioContext();
    await audio.resume();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = 330;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const stream = destination.stream;
    const track = stream.getAudioTracks()[0];
    const stop = track.stop.bind(track);
    let stopped = false;
    state.active++;
    track.stop = () => {
      if (stopped) return;
      stopped = true;
      state.active--; state.stops++;
      stop(); oscillator.stop(); oscillator.disconnect(); void audio.close();
    };
    waiting.resolve(stream);
  };
  state.deny = () => { const waiting = state.pending; state.pending = null; waiting.reject(new DOMException("Denied", "NotAllowedError")); };
  navigator.mediaDevices.getUserMedia = () => {
    state.requests++;
    const result = new Promise((resolve, reject) => { state.pending = { resolve, reject }; });
    if (state.auto) void state.approve();
    return result;
  };
  // Safari's speech API is deliberately absent; this must have no effect on dictation.
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  window.voiceFixture = state;
});
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(15000);
page.on("pageerror", error => errors.push(error.message));
const orb = page.locator("[data-assistant-orb]");
const assistant = page.locator("[data-assistant-phase]");
const field = page.getByRole("textbox", { name: "Describe a change" });
const phase = value => page.locator(`[data-assistant-phase="${value}"]`).waitFor();
const voicePhase = value => page.locator(`[data-voice-phase="${value}"]`).waitFor();
const snapshot = () => page.evaluate(async () => {
  const state = (await import("/src/store.ts")).useCapture.getState();
  return JSON.parse(JSON.stringify({ scenes: state.scenes, past: state.past, future: state.future }));
});
async function pressOrb() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator(".editorWorkspace").evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  const box = await orb.boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
}
async function resetNotices() {
  await page.evaluate(async () => {
    const { resetNotifications, setNotificationsBusy, useNotifications } = await import("/src/state/notifications/notificationStore.ts");
    const busy = useNotifications.getState().busy; resetNotifications(); setNotificationsBusy(busy);
  });
}
async function typing(draft = "Keep my draft") {
  if (await assistant.getAttribute("data-assistant-phase") === "idle") await orb.click();
  await phase("typing"); await field.fill(draft);
}
async function tapMicrophone() {
  await page.getByRole("button", { name: "Start voice input", exact: true }).click();
}
async function waitRecording() {
  await voicePhase("listening"); await page.waitForTimeout(350);
}
async function notice(id, copy) {
  await page.locator(`[data-notification-id="${id}"]`).waitFor();
  assert.equal(await page.getByText(copy, { exact: true }).count(), 1);
  assert.equal(await assistant.getByText(copy, { exact: true }).count(), 0);
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
  await page.evaluate(async () => {
    voiceFixture.requests = 0; voiceFixture.stops = 0;
    (await import("/src/store.ts")).useCapture.getState().patch({ localId: "voice-original-project", playing: true });
  });
  await typing();
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().playing), false);
  assert.equal(await page.evaluate(() => voiceFixture.requests), 0, "Opening typing must not ask for microphone access");
  await pressOrb(); await page.waitForTimeout(180); await page.mouse.up();
  assert.equal(await page.evaluate(() => voiceFixture.requests), 0, "A short tap must not record");

  // Hold/release uses real encoding and decoding and stays cancellable while HTTP waits.
  response = { text: "Softer colours", hold: true, status: 200 };
  await pressOrb(); await waitRecording();
  assert.equal(uploads.length, 0, "Listening must not upload audio");
  await page.mouse.up(); await voicePhase("transcribing");
  await page.getByText("Transcribing…", { exact: true }).waitFor();
  await page.waitForFunction(() => voiceFixture.active === 0);
  while (!pendingResponse) await page.waitForTimeout(20);
  assert.equal(uploads.length, 1);
  assert.equal(assistantFixture.requests.length, 0, "No assistant request before transcription finishes");
  pendingResponse(); pendingResponse = null;
  await phase("idle");
  assert.equal((await snapshot()).past.length, original.past.length + 1);
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().playing), true,
    "Submitting a recorded edit restores the previously playing scene");
  await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().patch({ playing: false }));
  await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual((await snapshot()).scenes, original.scenes);
  original = await snapshot();

  // Tap permission survives dialog focus changes and never uploads before explicit Send.
  await typing(); await page.evaluate(() => { voiceFixture.auto = false; });
  await page.getByRole("button", { name: "Start voice input", exact: true }).focus();
  await page.keyboard.down("Enter"); await voicePhase("starting");
  await page.keyboard.down("Enter"); await voicePhase("starting");
  await page.waitForFunction(() => voiceFixture.pending !== null);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await voicePhase("starting");
  await page.evaluate(() => voiceFixture.approve()); await waitRecording();
  await page.keyboard.down("Enter"); await voicePhase("listening");
  assert.equal(uploads.length, 1, "Holding Enter through permission must not send without a fresh press");
  await page.keyboard.up("Enter");
  response = { text: "Bolder", hold: false, status: 200 };
  await page.getByRole("button", { name: "Send voice request", exact: true }).click(); await phase("idle");
  assert.equal(uploads.length, 2, "Explicit one-word Send is permitted");
  assert.equal((await snapshot()).past.length, original.past.length + 1);
  original = await snapshot();

  // Cancel startup and a Cancel press racing with granted permission both discard late streams.
  await typing("Preserve on cancellation"); await tapMicrophone(); await voicePhase("starting");
  await page.waitForFunction(() => voiceFixture.pending !== null);
  await page.getByRole("button", { name: "Cancel voice input", exact: true }).click(); await phase("typing");
  await page.evaluate(() => voiceFixture.approve()); await page.waitForFunction(() => voiceFixture.active === 0);
  assert.equal(await field.inputValue(), "Preserve on cancellation");
  await tapMicrophone(); await voicePhase("starting"); await page.waitForFunction(() => voiceFixture.pending !== null);
  await pressOrb(); await page.evaluate(() => voiceFixture.approve()); await voicePhase("listening");
  await page.mouse.up(); await phase("typing"); await page.waitForFunction(() => voiceFixture.active === 0);
  assert.equal(uploads.length, 2); assert.deepEqual(await snapshot(), original);

  // Permission denial keeps the typed draft and reports one typed notification.
  await resetNotices(); await tapMicrophone(); await page.waitForFunction(() => voiceFixture.pending !== null);
  await page.evaluate(() => voiceFixture.deny()); await phase("typing");
  await notice("voiceDenied", "Microphone access denied.");
  assert.equal(await field.inputValue(), "Preserve on cancellation");
  await page.evaluate(() => { voiceFixture.auto = true; });

  // A pending transcription can be cancelled through the flower without a late send.
  response = { text: "Larger", hold: true, status: 200 };
  await tapMicrophone(); await waitRecording();
  await orb.focus(); await page.keyboard.down("Enter"); await voicePhase("transcribing");
  await page.keyboard.down("Enter"); await voicePhase("transcribing"); await page.keyboard.up("Enter");
  while (!pendingResponse) await page.waitForTimeout(20);
  const requestsBeforeCancel = assistantFixture.requests.length;
  await page.getByRole("button", { name: "Cancel voice input", exact: true }).click(); await phase("typing");
  pendingResponse(); pendingResponse = null; await page.waitForTimeout(100);
  assert.equal(assistantFixture.requests.length, requestsBeforeCancel); assert.deepEqual(await snapshot(), original);
  assert.equal(await field.inputValue(), "Preserve on cancellation");

  // Switching project invalidates a recorded request even if HTTP eventually succeeds.
  await tapMicrophone(); await waitRecording();
  await page.getByRole("button", { name: "Send voice request", exact: true }).click(); await voicePhase("transcribing");
  while (!pendingResponse) await page.waitForTimeout(20);
  await page.evaluate(async () => (await import("/src/store.ts")).useCapture.getState().patch({ localId: "voice-project-switch" }));
  await phase("idle"); pendingResponse(); pendingResponse = null; await page.waitForTimeout(100);
  assert.equal(assistantFixture.requests.length, requestsBeforeCancel); assert.deepEqual(await snapshot(), original);

  // Keyboard hold and navigation stop all tracks without uploading.
  await typing(); await orb.focus(); await page.keyboard.down("Space"); await waitRecording();
  const beforeHide = uploads.length;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.keyboard.up("Space"); await page.waitForFunction(() => voiceFixture.active === 0);
  assert.equal(uploads.length, beforeHide);
  await page.keyboard.press("Escape"); await phase("idle");

  // Server capability preflight fails before opening a microphone.
  await context.route("**/api/assistant/status", route => route.fulfill({ json: {
    provider: "open-source", available: true, model: "fixture",
    capabilities: { editing: true, frames: true, transcription: false, wordTiming: true, objectTracking: true },
    chatgpt: { available: false, reason: "hosted_access_required", message: "Fixture", documentationUrl: "https://developers.openai.com/siwc/token-sharing-open-source" },
  } }));
  await typing(); await resetNotices();
  const beforeUnavailable = await page.evaluate(() => voiceFixture.requests);
  await tapMicrophone(); await notice("assistantUnavailable", "Assistant unavailable. Try again later.");
  await phase("typing"); assert.equal(await page.evaluate(() => voiceFixture.requests), beforeUnavailable);
  await page.keyboard.press("Escape"); await phase("idle");

  for (const viewport of [{ width: 320, height: 740 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await typing();
    const bounds = await page.locator("[data-assistant-composer]").evaluate(form => {
      const input = form.querySelector("input").getBoundingClientRect();
      const buttons = [...form.querySelectorAll("button")].map(button => button.getBoundingClientRect().toJSON());
      return { input: input.toJSON(), buttons };
    });
    assert(bounds.input.width >= 60); assert(bounds.input.right <= bounds.buttons[0].left);
    assert(bounds.buttons[0].right <= bounds.buttons[1].left); assert(bounds.buttons[1].right <= viewport.width);
    await page.keyboard.press("Escape"); await phase("idle");
  }
  assert.equal(await page.evaluate(() => voiceFixture.active), 0);
  assert.deepEqual(errors, []);
  console.log(`Assistant voice checks passed: ${uploads.length} real encoded/decoded WAV uploads to mocked HTTP; hold, tap, permission races, cancellation, project changes, unavailable service and responsive controls.`);
} catch (error) {
  console.error(error.stack);
  console.error(await page.evaluate(async () => {
    const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
    return { phase: useAssistant.getState().phase, failure: useAssistant.getState().failureDetail,
      microphone: { requests: voiceFixture.requests, active: voiceFixture.active, stops: voiceFixture.stops } };
  }));
  console.error((await page.locator("body").innerText()).slice(0, 1600));
  console.error(errors); process.exitCode = 1;
} finally {
  pendingResponse?.(); await context.close(); await browser.close();
}
