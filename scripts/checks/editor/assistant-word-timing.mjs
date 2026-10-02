import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture } from "./assistant-fixture.mjs";
import { loadStudyMedia } from "./assistant-tool-study/mediaFixture.mjs";

// The planner is a fixture. The first alignment is real; identical payloads reuse
// that exact response. Browser decoding, adapters, compiler, Undo and Try are real.
const output = process.env.WORD_TIMING_OUTPUT || "/tmp/pvo-mfa-native-validation";
const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:5196/";
const apiOrigin = new URL(process.env.WORD_TIMING_API || "http://127.0.0.1:4174").origin;
const transcript = "I don't want peace. I want problems always.";
const preflightOnly = process.env.WORD_TIMING_PREFLIGHT === "1";
const capturePath = process.env.WORD_TIMING_ALIGNMENT_CAPTURE;
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const request = { kind: "word_timing", sceneId: "main", start: 0, end: 4,
  source: { kind: "clip", id: 101 }, text: transcript, language: "en" };
await mkdir(output, { recursive: true });
const result = { startedAt: new Date().toISOString(), planner: "fixture replies; no LLM inference",
  alignment: "One actual HTTP alignment, followed by exact-payload cached replay for mapping/workflow checks",
  limitation: "Mechanical pause timing relative to the configured MFA estimate, not human speech-boundary truth or proof of no audible leakage. Source captions already expose the answer.",
  network: [], nativeRequests: [], playback: [], errors: [], status: "FAIL" };
const cache = new Map();
if (capturePath) {
  const captured = JSON.parse(await readFile(capturePath, "utf8"));
  const wav = await readFile(path.join(path.dirname(capturePath), "actual-alignment-input.wav"));
  assert.equal(captured.status, 200, "A replay requires a successful actual alignment response");
  const payload = { audio: wav.toString("base64"), duration: 4, text: transcript, language: "en" };
  const key = hash(JSON.stringify(payload));
  cache.set(key, captured.value);
  result.capture = { file: capturePath, payloadSha256: key, wavSha256: hash(wav), newAlignmentCalls: 0 };
  result.alignment = "Exact captured real alignment response replay; no new inference. Every replay requires identical request bytes.";
  await writeFile(path.join(output, "actual-alignment-input.wav"), wav);
  await writeFile(path.join(output, "actual-alignment-response.json"), JSON.stringify(captured, null, 2));
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
await installAssistantAvailabilityFixture(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
let failureMode = null, scenario = null, phase = 0, original = null, measuredBoundary = null;
page.on("pageerror", error => result.errors.push(error.message));
const snapshot = () => page.evaluate(() => window.wordTimingTest.snapshot());
await page.route("**/api/assistant/transcribe", route => {
  result.errors.push("Unexpected paid transcription request"); return route.abort();
});
await page.route("**/api/assistant/align", async route => {
  const started = performance.now(), payload = route.request().postDataJSON();
  const key = hash(JSON.stringify(payload));
  const record = { payloadSha256: key, wavSha256: hash(Buffer.from(payload.audio, "base64")), duration: payload.duration, failureMode };
  result.network.push(record);
  try {
    if (failureMode === "unavailable") { record.injected = true; await route.fulfill({ status: 503, json: { error: "Alignment unavailable for this regression." } }); return; }
    if (failureMode === "malformed") {
      assert(cache.has(key), "Malformed regression mutates a captured real response only");
      const value = clone(cache.get(key)); value.words[0].start = -1;
      record.injected = true; await route.fulfill({ json: value }); return;
    }
    if (cache.has(key)) { record.cached = true; await route.fulfill({ json: cache.get(key) }); return; }
    assert.equal(cache.size, 0, "Only one real alignment is permitted in this regression");
    const response = await fetch(`${apiOrigin}/api/assistant/align`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: apiOrigin },
      body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(125000),
    });
    const value = await response.json(); record.status = response.status; record.cached = false;
    await writeFile(path.join(output, "actual-alignment-response.json"), JSON.stringify({ status: response.status, value }, null, 2));
    await writeFile(path.join(output, "actual-alignment-input.wav"), Buffer.from(payload.audio, "base64"));
    if (response.ok) cache.set(key, value);
    await route.fulfill({ status: response.status, json: value });
  } catch (error) {
    record.error = error.message; await route.fulfill({ status: 503, json: { error: "Word timing test transport failed." } });
  } finally { record.durationMs = Math.round(performance.now() - started); }
});
await page.route("**/api/assistant/turn", async route => {
  try {
    assert.equal(route.request().headers()["x-assistant-word-timing"], "1", "The current client explicitly negotiates word-timing support");
    const input = parseNativeTurnRequest(route.request().postDataJSON());
    result.nativeRequests.push({ scenario, phase, input });
    assert.deepEqual((await snapshot()).project, original.project, "Every intermediate candidate must remain private");
    const scene = input.project.scenes[0];
    let operations = [], observations = [], blocked = false;
    if (scenario === "success") {
      if (phase === 0) observations = [request];
      if (phase === 1) {
        const timing = input.observations.find(item => item.kind === "word_timing");
        assert(timing, "Real timing observation must reach the native planning context");
        const index = timing.words.findIndex((word, i) => word.text === "want" && timing.words[i + 1]?.text === "peace");
        assert(index >= 0); measuredBoundary = (timing.words[index].end + timing.words[index + 1].start) / 2;
        assert(measuredBoundary >= 0.5 && measuredBoundary < 1.5, "Measured fixture boundary must support a visible quiz");
        operations = [{ kind: "component.add", sceneId: "main", componentType: "choice", at: 0, duration: measuredBoundary,
          responsePolicy: { dispatch: "layer_end", unanswered: "pause" } }];
      }
      if (phase === 2) operations = [
        { kind: "component.content", sceneId: "main", componentId: scene.components[0].id,
          changes: { prompt: "I don't want… Guess the next word.", optionLabels: ["Peace", "Problems"] } },
        { kind: "text.add", sceneId: "main", text: "Answer: peace", start: measuredBoundary + 0.15, end: 4 },
      ];
    } else {
      if (phase === 0) operations = [{ kind: "text.add", sceneId: "main", text: "Private partial edit", start: 0, end: 1 }];
      if (phase === 1) observations = [request];
      if (phase === 2) {
        assert.equal(input.observations[0]?.kind, "unavailable");
        assert.equal(input.observations[0]?.requestedKind, "word_timing"); blocked = true;
      }
    }
    phase += 1;
    await route.fulfill({ json: parseNativeTurnResult({ message: blocked ? "Timing is unavailable; no changes were applied." : "Word timing regression step.",
      operations, observations, ...(blocked ? { blocked: true } : {}) }) });
  } catch (error) {
    result.errors.push(error.message); await route.fulfill({ status: 500, json: { error: "Timing regression fixture failed." } });
  }
});

async function submit(kind) {
  scenario = kind; phase = 0; original = await snapshot();
  await page.locator("[data-assistant-orb]").click();
  await page.getByRole("textbox", { name: "Describe a change", exact: true }).fill("Pause after I don't want, before the next word; let me guess and then reveal the answer.");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.waitForFunction(() => window.wordTimingTest.assistant.getState().phase !== "working", null, { timeout: 135000 });
  const current = await snapshot();
  if (kind === "success") {
    assert.equal(current.past, original.past + 1);
    assert.deepEqual(current.project.scenes[0].clips, original.project.scenes[0].clips);
    // Completion notices expire and may be displaced by unrelated persistence status.
    // The authoritative edit/history assertions above do not depend on that notice.
    const dismiss = page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Dismiss notification", exact: true });
    if (await dismiss.isVisible()) await dismiss.click({ timeout: 500 }).catch(() => {});
    const history = await page.evaluate(() => {
      const test = window.wordTimingTest; test.store.getState().undo(); const undone = test.snapshot();
      test.store.getState().redo(); return { undone, redone: test.snapshot() };
    });
    assert.deepEqual(history.undone.project, original.project); assert.deepEqual(history.redone.project, current.project);
    result.nativeEdit = { before: original, after: current, ...history, estimatedBoundary: measuredBoundary };
  } else {
    assert.deepEqual(current.project, original.project); assert.equal(current.past, original.past);
    assert.equal(current.assistant.phase, "review");
    result[kind] = { privateCandidateDiscarded: true, before: original, after: current };
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
}

async function verifyPlayback() {
  const authored = await snapshot(), quiz = authored.project.scenes[0].components[0];
  const reveal = authored.project.scenes[0].texts.find(text => text.text === "Answer: peace");
  const revealLayer = page.locator(`.pvBox[data-trying="true"] [data-layer-id="text:${reveal.id}"]`);
  const component = page.locator(`[data-preview-component="${quiz.id}"]`);
  const controls = quiz.code?.custom ? component.frameLocator(`iframe[title="Component ${quiz.id}"]`) : component;
  const stop = async () => {
    await page.getByRole("button", { name: "Stop trying", exact: true }).click();
    const stopped = await snapshot(); assert.deepEqual(stopped.project, authored.project);
    assert.equal(stopped.past, authored.past); assert.equal(stopped.t, authored.t);
  };
  const resumed = async () => page.waitForFunction(({ id, boundary }) => {
    const s = window.wordTimingTest.store.getState(), video = document.querySelector(".pvVideo");
    return s.tryMode?.dispatched.includes(id) && s.playing && s.tryMode.holdingId === null && video && !video.paused && video.currentTime > boundary + 0.3;
  }, { id: quiz.id, boundary: measuredBoundary });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const label of ["Peace", "Problems"]) {
      const pausesBefore = (await snapshot()).pauseEvents.length;
      await page.getByRole("button", { name: "Try", exact: true }).click();
      await page.waitForFunction(({ id, boundary }) => {
        const s = window.wordTimingTest.store.getState(), video = document.querySelector(".pvVideo");
        return s.tryMode?.holdingId === id && !s.playing && Math.abs(s.t - boundary) < 0.001
          && video?.paused && !video.seeking && Math.abs(video.currentTime - boundary) < 0.025;
      }, { id: quiz.id, boundary: measuredBoundary });
      const held = await snapshot();
      const playbackRun = { viewport, label, held };
      result.playback.push(playbackRun);
      assert(held.pauseEvents.length > pausesBefore);
      assert(held.pauseEvents.at(-1).time <= measuredBoundary + 0.05, "Raw media pause must be within 50ms of configured estimate, before corrective seeking");
      assert.equal(await revealLayer.count(), 0, "Authored answer reveal is absent in the player while held; timeline labels and baked source captions are outside this assertion");
      await page.waitForTimeout(600);
      const still = await snapshot(); assert.equal(still.holdingId, quiz.id); assert.equal(still.video.paused, true);
      assert(Math.abs(still.video.time - held.video.time) < 0.005);
      await page.screenshot({ path: path.join(output, `held-${viewport.width}-${label.toLowerCase()}.png`) });
      await controls.getByRole("button", { name: label, exact: true }).click();
      await resumed();
      await revealLayer.waitFor({ state: "visible" });
      Object.assign(playbackRun, { stillHeld: still, resumed: await snapshot() });
      await stop();
    }
    await page.getByRole("button", { name: "Try", exact: true }).click();
    await controls.getByRole("button", { name: "Peace", exact: true }).click();
    const early = await snapshot();
    assert(early.t < measuredBoundary); assert(early.captured[quiz.id]); assert(!early.dispatched.includes(quiz.id));
    await resumed(); result.playback.push({ viewport, earlyAnswer: early, resumed: await snapshot() }); await stop();
  }
}

try {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const media = await loadStudyMedia(page, process.env.ACCEPTANCE_MEME_VIDEO || "/Users/christinasmacbook/Downloads/snaptik_7643305471486545166_hd.mp4");
  result.preflight = await page.evaluate(async ({ media, request }) => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { projectSnapshot, restore } = await import("/src/state/project/history.ts");
    const { useAssistant, resetAssistant } = await import("/src/state/assistant/assistantStore.ts");
    const { inspectionWordTiming, mapAlignedWords } = await import("/src/domain/assistant/wordTiming.ts");
    const { extractWordTimingAudio } = await import("/src/infrastructure/assistant/media/wordAudio.ts");
    const { alignAssistantWords } = await import("/src/infrastructure/assistant/media/wordTiming.ts");
    // Imported editor media is a browser Blob; use that normal persistence path.
    // The routed URL is only the fixture transport for these identical source bytes.
    const mediaResponse = await fetch(media.url);
    if (!mediaResponse.ok) throw new Error("Could not load the word timing fixture");
    const mediaBlob = await mediaResponse.blob();
    const mediaUrl = URL.createObjectURL(mediaBlob);
    const clip = { id: 101, url: mediaUrl, srcDur: media.duration, in: 0, out: 8, speed: 1,
      zoom: 1, mirror: false, fit: "contain", color: "#222222", width: media.width, height: media.height };
    const base = { currentSceneId: "main", ratio: "9:16", allowedDomains: [], scenes: [{ id: "main", name: "Word timing test", parent: null,
      muted: false, sound: 0, clipGain: 1, musicGain: 1, clips: [clip], texts: [], components: [], audioClips: [] }] };
    const copy = value => JSON.parse(JSON.stringify(value));
    const variants = [];
    const add = (name, change, changes = {}) => { const project = copy(base); change(project.scenes[0]); variants.push({ name, project, request: { ...request, ...changes } }); };
    add("normal", () => {});
    add("double-speed", scene => { scene.clips[0].speed = 2; }, { end: 2 });
    add("prefix-offset", scene => { scene.clips.unshift({ ...clip, id: 102, out: 1, audioDetached: true }); }, { start: 1, end: 5 });
    add("end-trim", scene => { scene.clips[0].out = 4; });
    add("detached-offset-double", scene => { scene.clips[0].audioDetached = true; scene.audioClips = [{ ...clip, id: 201, name: "Detached", start: 1.25, speed: 2, muted: false, gain: 1 }]; },
      { source: { kind: "audio", id: 201 }, start: 1.25, end: 3.25 });
    const rows = [];
    const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    for (const variant of variants) {
      const source = inspectionWordTiming(variant.project, variant.request), wav = await extractWordTimingAudio(source);
      rows.push({ name: variant.name, source, wavBytes: wav.byteLength, wavSha256: await sha(wav) });
    }
    const trimmed = copy(base); trimmed.scenes[0].clips[0].in = 0.25;
    const trimRequest = { ...request, end: 3.75 }, untrimmedRequest = { ...request, start: 0.25 };
    const trimmedSource = inspectionWordTiming(trimmed, trimRequest);
    const sourceTrim = { trimmedSha256: await sha(await extractWordTimingAudio(trimmedSource)),
      untrimmedSha256: await sha(await extractWordTimingAudio(inspectionWordTiming(base, untrimmedRequest))), source: trimmedSource };
    const clean = initial(); useCapture.setState({ ...clean, ...restore(clean, base), screen: "editor" }); resetAssistant();
    window.wordTimingTest = { store: useCapture, assistant: useAssistant, variants, base, request, alignAssistantWords, mapAlignedWords, trimmedSource, pauseEvents: [],
      snapshot: () => {
        const state = useCapture.getState(), video = document.querySelector(".pvVideo");
        return copy({ project: projectSnapshot(state), past: state.past.length, t: state.t, playing: state.playing,
          holdingId: state.tryMode?.holdingId ?? null, captured: state.tryMode?.capturedResponses ?? {}, dispatched: state.tryMode?.dispatched ?? [],
          video: video ? { time: video.currentTime, paused: video.paused, seeking: video.seeking } : null,
          pauseEvents: window.wordTimingTest.pauseEvents, assistant: useAssistant.getState() });
      } };
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...args) {
      if (this.matches(".pvVideo") && !this.paused && useCapture.getState().tryMode?.holdingId)
        window.wordTimingTest.pauseEvents.push({ time: this.currentTime, at: performance.now() });
      return originalPause.apply(this, args);
    };
    return { rows, sourceTrim, fixtureMedia: { transport: "HTTP fixture converted to normal imported Blob", bytes: mediaBlob.size } };
  }, { media, request });
  assert.equal(new Set(result.preflight.rows.map(row => row.wavSha256)).size, 1, "Every identical physical excerpt must produce identical natural-rate WAV despite authored speed/offset/end trim");
  assert(result.preflight.rows.every(row => row.wavBytes === 128044));
  assert.equal(result.preflight.sourceTrim.trimmedSha256, result.preflight.sourceTrim.untrimmedSha256);
  if (!preflightOnly) {
    result.mapping = await page.evaluate(async () => {
      const test = window.wordTimingTest, observations = [];
      for (const variant of test.variants) observations.push({ name: variant.name, result: await test.alignAssistantWords(variant.project, variant.request) });
      const normal = observations[0].result;
      const sourceWords = normal.words.filter(word => word.sourceStart >= 0.25).map(word => ({ text: word.text, start: word.sourceStart - 0.25, end: word.sourceEnd - 0.25 }));
      return { observations, trimmedDomainMappingOnly: test.mapAlignedWords(test.trimmedSource, sourceWords) };
    });
    const normal = result.mapping.observations[0].result;
    assert.equal(normal.provenance.transcriptVerified, false);
    for (const { name, result: mapped } of result.mapping.observations) for (const [index, word] of mapped.words.entries()) {
      const source = normal.words[index];
      const expected = name === "double-speed" ? source.start / 2 : name === "prefix-offset" ? source.start + 1
        : name === "detached-offset-double" ? source.start / 2 + 1.25 : source.start;
      assert(Math.abs(word.start - expected) < 1e-8, `${name} scene mapping`);
      assert.equal(word.sourceStart, source.sourceStart); assert.equal(word.sourceEnd, source.sourceEnd);
    }
    for (const word of result.mapping.trimmedDomainMappingOnly) assert(Math.abs(word.start - (word.sourceStart - 0.25)) < 1e-8);
    await submit("success");
    await verifyPlayback();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const mode of ["unavailable", "malformed"]) { failureMode = mode; await submit(mode); }
    assert.equal(result.network.filter(row => row.cached === false).length, capturePath ? 0 : 1,
      "Only the declared genuine alignment or exact captured replays are permitted");
  }
  assert.deepEqual(result.errors, []);
  result.status = "PASS";
} catch (error) {
  result.failure = { name: error.name, message: error.message, stack: error.stack };
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  result.endedAt = new Date().toISOString(); result.preflightOnly = preflightOnly;
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ status: result.status, output, preflightOnly, actualAlignments: result.network.filter(row => row.cached === false).length,
  cachedResponses: result.network.filter(row => row.cached === true).length, failure: result.failure?.message }));
