import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { finishAssistantVerification, preparedAssistantBatches } from "./assistant-fixture.mjs";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const calls = [];
const controlled = new Map();
function holdResponse(prompt, body, status = 200, preparedSteps = 0, observations = 0) {
  let release, receive, complete;
  const ready = new Promise(resolve => { release = resolve; });
  const received = new Promise(resolve => { receive = resolve; });
  const completed = new Promise(resolve => { complete = resolve; });
  controlled.set(`${prompt}:${preparedSteps}:${observations}`, { ready, receive, complete, body, status });
  return { release, received, completed };
}
await context.route("**/api/assistant/turn", async route => {
  const request = parseNativeTurnRequest(route.request().postDataJSON());
  calls.push(request);
  assert.equal(request.mode, "plan", "Every request uses automatic routing and validated editing");
  const key = `${request.prompt}:${preparedAssistantBatches(request).length}:${request.observations.length}`;
  const fixture = controlled.get(key);
  if (fixture) {
    controlled.delete(key);
    fixture.receive(request);
    await fixture.ready;
    try { await route.fulfill({ status: fixture.status,
      json: typeof fixture.body === "function" ? fixture.body(request) : fixture.body }); }
    catch (error) { if (!/closed|cancel|Invalid Interception/i.test(String(error))) throw error; }
    finally { fixture.complete(); }
    return;
  }
  if (await finishAssistantVerification(route, request)) return;
  const question = request.prompt === "Describe this project";
  const operations = question ? [] : request.prompt === "Prepare export"
    ? [{ kind: "export.prepare", format: "video" }]
    : [{ kind: "text.add", sceneId: "main", text: "Summer sale", start: 2, end: 5 },
      { kind: "clip.trim", sceneId: "main", clipId: request.project.scenes[0].clips[0].id, sourceIn: 1, sourceOut: 10 },
      { kind: "scene.update", sceneId: "main", changes: { musicGain: 0.25, clipGain: 0.4 } }];
  try { await route.fulfill({ json: { message: question ? "This project contains one scene." : "Ready to update your project.", operations, observations: [] } }); }
  catch (error) { if (!/closed|cancel|Invalid Interception/i.test(String(error))) throw error; }
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
const orb = page.locator("[data-assistant-orb]");
const review = page.getByRole("region", { name: "Assistant answer", exact: true });
const field = page.getByRole("textbox", { name: "Describe a change", exact: true });
const phase = name => page.locator(`[data-assistant-phase="${name}"]`);
const snapshot = () => page.evaluate(async () => {
  const { useCapture } = await import("/src/state/captureStore.ts");
  const state = useCapture.getState();
  return { texts: state.texts, clips: state.clips, scene: state.scenes[0], past: state.past.length, sheet: state.sheet, ratio: state.ratio };
});
const submit = async (text, result = "applied") => {
  await field.fill(text);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  if (result === "answer") await phase("review").waitFor();
  else await page.locator('[data-notification-id="assistantApplied"]').waitFor();
};

async function checkMultiStepChoice() {
  const original = await snapshot();
  const prompt = "Add a choice asking where to go with Mountain and Beach options";
  let generatedId;
  const create = holdResponse(prompt, { message: "Create the choice first.", observations: [], operations: [
    { kind: "component.add", sceneId: "main", componentType: "choice", at: 1, duration: 4 },
  ] });
  const personalize = holdResponse(prompt, request => {
    const choice = request.project.scenes[0].components.find(component => component.id === generatedId);
    assert(choice, "The second step must address the actual generated choice ID");
    return { message: "Set the question and both options.", observations: [], operations: [
      { kind: "component.content", sceneId: "main", componentId: choice.id,
        changes: { prompt: "Where next?", optionLabels: ["Mountain", "Beach"] } },
    ] };
  }, 200, 1);
  const finish = holdResponse(prompt, { message: "The complete choice is ready.", operations: [], observations: [] }, 200, 2);

  await orb.click();
  await field.fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await create.received;
  create.release();
  const createdRequest = await personalize.received;
  const created = createdRequest.project.scenes[0].components;
  assert.equal(created.length, original.scene.components.length + 1, "The next model turn sees the prepared component");
  const choice = created.find(component => !original.scene.components.some(before => before.id === component.id));
  assert(choice && choice.type === "choice" && choice.source, "A new choice exposes its actual ID and compiled default source");
  generatedId = choice.id;
  assert.equal(preparedAssistantBatches(createdRequest)[0][0].kind, "component.add");
  assert.deepEqual(await snapshot(), original, "Preparing a default choice cannot mutate the live project or history");
  assert.equal(await phase("working").count(), 1);
  assert.equal(await page.locator('[data-notification-id="assistantApplied"]').count(), 0);

  personalize.release();
  const completedRequest = await finish.received;
  const personalized = completedRequest.project.scenes[0].components.find(component => component.id === generatedId);
  assert.equal(personalized.content.prompt, "Where next?");
  assert.equal(personalized.content.option0, "Mountain");
  assert.equal(personalized.content.option1, "Beach");
  assert.equal(preparedAssistantBatches(completedRequest)[1][0].componentId, generatedId);
  assert.deepEqual(await snapshot(), original, "The full candidate remains private until the model finishes the request");
  assert.equal(await phase("working").count(), 1);
  finish.release();

  const notice = page.locator('[data-notification-id="assistantApplied"]');
  await notice.waitFor();
  await notice.hover();
  const applied = await snapshot();
  const appliedChoice = applied.scene.components.find(component => component.id === generatedId);
  assert.equal(appliedChoice.fields.prompt, "Where next?");
  assert.deepEqual(appliedChoice.fields.options.map(option => option.label), ["Mountain", "Beach"]);
  assert.equal(applied.past, original.past + 1, "Create and personalize commit once as one history entry");
  assert.equal(calls.filter(request => request.prompt === prompt).length, 3, "Two prepared steps and one terminal turn complete the workflow");
  assert.equal(await review.count(), 0, "A completed edit does not open an answer or Keep step");
  await notice.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await snapshot();
  assert.deepEqual(undone.scene, original.scene, "One Undo removes the complete generated choice");
  assert.equal(undone.past, original.past);
}

async function checkNoopAndBlocked() {
  const original = await snapshot();
  const noopPrompt = "Keep the current canvas ratio";
  const noop = holdResponse(noopPrompt, request => ({
    message: "Check the current canvas setting.", observations: [],
    operations: [{ kind: "project.ratio", ratio: request.project.ratio }],
  }));
  const noopFinish = holdResponse(noopPrompt, {
    message: "The canvas already uses that ratio, so nothing needed changing.", operations: [], observations: [],
  }, 200, 1);
  await orb.click();
  await field.fill(noopPrompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await noop.received;
  noop.release();
  await noopFinish.received;
  assert.deepEqual(await snapshot(), original, "A prepared no-op does not create an edit");
  noopFinish.release();
  await review.getByText("The canvas already uses that ratio, so nothing needed changing.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), original, "A completed no-op explains the outcome without adding history");
  assert.equal(await page.locator('[data-notification-id="assistantApplied"]').count(), 0);
  await review.getByRole("button", { name: "Done", exact: true }).click();

  const blockedPrompt = "Add a title and use my preferred ending";
  const partial = holdResponse(blockedPrompt, { message: "Prepare the title first.", observations: [], operations: [
    { kind: "text.add", sceneId: "main", text: "Uncommitted title", start: 0, end: 2 },
  ] });
  const blocked = holdResponse(blockedPrompt, {
    message: "Which ending do you prefer?", operations: [], observations: [], blocked: true,
  }, 200, 1);
  await orb.click();
  await field.fill(blockedPrompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await partial.received;
  partial.release();
  const candidate = await blocked.received;
  assert(candidate.project.scenes[0].texts.some(text => text.text === "Uncommitted title"),
    "The blocking decision examines the actual prepared candidate");
  assert.deepEqual(await snapshot(), original, "A partial task remains private while its blocker is checked");
  blocked.release();
  await review.getByText("Which ending do you prefer? No changes were applied.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), original, "A blocked terminal result discards every prepared change and history entry");
  assert.equal(await page.locator('[data-notification-id="assistantApplied"]').count(), 0);
  assert.equal(calls.filter(request => request.prompt === noopPrompt).length, 2);
  assert.equal(calls.filter(request => request.prompt === blockedPrompt).length, 2);
  await review.getByRole("button", { name: "Done", exact: true }).click();
}

async function checkMixedAnswer() {
  const original = await snapshot();
  const prompt = "Add a short title and explain how long it stays visible";
  const edit = holdResponse(prompt, { message: "Prepare a two-second title.", observations: [], operations: [
    { kind: "text.add", sceneId: "main", text: "A fresh start", start: 1, end: 3 },
  ] });
  const finish = holdResponse(prompt, { message: "The title is ready.", operations: [], observations: [],
    answer: "The title appears at one second and disappears at three seconds, so it stays visible for two seconds.",
  }, 200, 1);
  await orb.click();
  await field.fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await edit.received;
  edit.release();
  await finish.received;
  assert.deepEqual(await snapshot(), original);
  finish.release();
  await review.getByText("The title appears at one second and disappears at three seconds, so it stays visible for two seconds.", { exact: true }).waitFor();
  const applied = await snapshot();
  assert.equal(applied.texts[0].text, "A fresh start");
  assert.equal(applied.past, original.past + 1);
  const undo = page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  assert.deepEqual((await snapshot()).scene, original.scene, "The answer does not interfere with atomic Undo");
  assert.equal((await snapshot()).past, original.past);
  await review.getByRole("button", { name: "Done", exact: true }).click();
}

async function checkConversationLifecycle() {
  const original = await snapshot();
  const originalLocalId = await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const localId = useCapture.getState().localId;
    useCapture.setState({ localId: "assistant-browser-session-one" });
    return localId;
  });
  const prompt = "Describe the first sampled frame";
  const inspect = holdResponse(prompt, { message: "Inspect the opening frame.", operations: [], observations: [
    { kind: "frames", sceneId: "main", start: 0, end: 1, count: 1 },
  ] });
  const explain = holdResponse(prompt, { message: "The sampled opening frame has a coloured background.", operations: [], observations: [],
    evidence: ["main at 0.5s: a coloured placeholder background."],
  }, 200, 0, 1);
  await orb.click();
  await field.fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await inspect.received;
  inspect.release();
  const observed = await explain.received;
  assert.equal(observed.observations[0].kind, "frames");
  assert.equal(observed.observations[0].frames.length, 1, "The fixture receives a real browser-sampled frame before returning evidence");
  explain.release();
  await review.getByText("The sampled opening frame has a coloured background.", { exact: true }).waitFor();
  await review.getByRole("button", { name: "Done", exact: true }).click();
  const conversation = () => page.evaluate(async () => {
    const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
    const { history, evidence } = useAssistant.getState();
    return { history, evidence };
  });
  const retained = await conversation();
  assert(retained.history.some(item => item.content === prompt));
  assert(retained.evidence.some(item => item.content.includes("coloured placeholder background")));
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().patch({ sheet: "sound" });
  });
  await orb.waitFor({ state: "hidden" });
  assert.deepEqual(await conversation(), retained, "A temporary Sound panel preserves same-project conversation and evidence");
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().patch({ sheet: null });
  });
  await orb.waitFor();
  assert.deepEqual(await conversation(), retained, "Closing the panel keeps the next request grounded in earlier observations");
  assert.deepEqual(await snapshot(), original, "Inspecting and opening a panel do not mutate the project");
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.setState({ localId: "assistant-browser-session-two" });
  });
  await page.waitForFunction(async () => {
    const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
    return useAssistant.getState().history.length === 0;
  });
  assert.deepEqual(await conversation(), { history: [], evidence: [] }, "A different project clears the prior conversation and evidence");
  await page.evaluate(async localId => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.setState({ localId });
  }, originalLocalId);
}

async function checkProgressAndRetries(layout) {
  const original = await snapshot();
  const stoppedPrompt = `Stop this ${layout} request`;
  const stale = holdResponse(stoppedPrompt, { message: "This stopped response must be ignored.", observations: [],
    operations: [{ kind: "text.add", sceneId: "main", text: "Stopped response", start: 0, end: 2 }] });
  await orb.click();
  await field.fill(stoppedPrompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await stale.received;
  await phase("working").waitFor();
  const heading = page.locator("[data-assistant-live-heading]");
  assert.equal((await heading.innerText()).toLowerCase(), "reading your project…", `${layout}: show the actual workflow progress`);
  assert.equal(await heading.getAttribute("role"), "status");
  assert.equal(await field.count(), 0, `${layout}: there is no second composer during a request`);
  assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).count(), 0);
  const stop = page.getByRole("button", { name: "Stop request", exact: true });
  await stop.getByText("Stop", { exact: true }).waitFor();
  await stop.click();
  await phase("typing").waitFor();
  assert.equal(await field.inputValue(), stoppedPrompt, `${layout}: Stop retains the request for retry`);
  assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).isEnabled(), true);

  const nextPrompt = `Continue this ${layout} request`;
  const next = holdResponse(nextPrompt, { message: "The next request completed.", operations: [], observations: [] });
  await field.fill(nextPrompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await next.received;
  stale.release();
  await stale.completed;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await phase("working").count(), 1, `${layout}: a stopped response cannot end the next request`);
  assert.equal(await page.locator("[data-assistant-live-content]").innerText(), nextPrompt);
  assert.deepEqual(await snapshot(), original, `${layout}: a late stopped response cannot edit the project`);
  next.release();
  await review.getByText("The next request completed.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), original);
  await review.getByRole("button", { name: "Done", exact: true }).click();

  await orb.click();
  const retryPrompt = `Retry this ${layout} question`;
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const failed = holdResponse(retryPrompt, { error: { message: "Private upstream rate-limit detail." } }, 429);
    await field.fill(retryPrompt);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await failed.received;
    failed.release();
    await phase("typing").waitFor();
    const notice = page.locator('[data-notification-id="assistantBusy"]');
    await notice.waitFor();
    assert.equal(await page.locator("[data-notification-id]").count(), 1, `${layout}: one top notice per failed attempt`);
    assert.equal(await field.inputValue(), retryPrompt);
    assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).isEnabled(), true);
    assert.equal(await page.getByText("Private upstream rate-limit detail.", { exact: true }).count(), 0);
    assert.deepEqual(await snapshot(), original, `${layout}: repeated failures leave the project untouched`);
    await notice.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  }
  assert(Date.now() - started < 10000, `${layout}: both attempts exercise the notification cooldown window`);
  const retry = holdResponse(retryPrompt, { message: "The retry succeeded.", operations: [], observations: [] });
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await retry.received;
  retry.release();
  await review.getByText("The retry succeeded.", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-notification-id="assistantBusy"]').count(), 0);
  assert.deepEqual(await snapshot(), original, `${layout}: a successful question retry does not add history`);
  await review.getByRole("button", { name: "Done", exact: true }).click();
}

async function checkTranscriptionAllowanceFailure() {
  const url = await page.evaluate(async () => {
    const { monoWav } = await import("/src/infrastructure/assistant/media/wav.ts");
    const { useCapture } = await import("/src/state/captureStore.ts");
    const samples = Float32Array.from({ length: 16000 }, (_, index) => 0.2 * Math.sin(index / 16000 * 440 * Math.PI * 2));
    const url = URL.createObjectURL(new Blob([monoWav(samples, 16000)], { type: "audio/wav" }));
    useCapture.getState().patch({ audioClips: [{ id: 700, name: "Inspection test", url,
      srcDur: 1, in: 0, out: 1, speed: 1, start: 0, muted: false }] });
    return url;
  });
  const prompt = "Add a title and check the spoken answer";
  const original = await snapshot();
  let transcriptions = 0;
  const transcribe = async route => {
    transcriptions++;
    assert.equal(route.request().headers()["content-type"], "audio/wav");
    assert.equal(route.request().postDataBuffer().byteLength, 32044, "The real browser audio extractor reaches the transcription endpoint");
    await route.fulfill({ status: 429, json: { error: "Private upstream allowance detail.", code: "provider_allowance_exhausted" } });
  };
  await context.route("**/api/assistant/transcribe", transcribe);
  try {
    const edit = holdResponse(prompt, { message: "Prepare the title.", observations: [], operations: [
      { kind: "text.add", sceneId: "main", text: "Private candidate only", start: 0, end: 2 },
    ] });
    const inspect = holdResponse(prompt, { message: "Listen to the answer.", operations: [], observations: [
      { kind: "transcript", sceneId: "main", start: 0, end: 1 },
    ] }, 200, 1);
    await orb.click();
    await field.fill(prompt);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await edit.received;
    edit.release();
    await inspect.received;
    inspect.release();
    const notice = page.locator('[data-notification-id="assistantAllowanceExhausted"]');
    await notice.waitFor();
    await phase("typing").waitFor();
    assert.equal(await notice.getByText("AI provider allowance used up.", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-notification-id]").count(), 1);
    assert.equal(await field.inputValue(), prompt);
    assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).isEnabled(), true);
    assert.equal(await page.getByText("Private upstream allowance detail.", { exact: true }).count(), 0);
    assert.deepEqual(await snapshot(), original, "A refused transcription discards prepared edits and preserves history");
    assert.equal(transcriptions, 1);
    assert.equal(calls.filter(request => request.prompt === prompt).length, 2,
      "A provider allowance refusal ends the task instead of asking another model to guess unavailable media");
    await page.keyboard.press("Escape");
    await phase("idle").waitFor();
  } finally {
    await context.unroute("**/api/assistant/transcribe", transcribe);
    await page.evaluate(async url => {
      const { useCapture } = await import("/src/state/captureStore.ts");
      useCapture.getState().patch({ audioClips: [] });
      URL.revokeObjectURL(url);
    }, url);
  }
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5195/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { mkClip } = await import("/src/store.ts");
    useCapture.setState(initial());
    useCapture.getState().patch({ screen: "editor", clips: [mkClip(10, null, 0)], sound: 1, playing: false });
  });
  await orb.click();
  await submit("Describe this project", "answer");
  await review.getByText("This project contains one scene.", { exact: true }).waitFor();
  assert.equal((await snapshot()).past, 0);
  assert.equal(await page.getByRole("tab", { name: /^(Ask|Plan|Edit)$/ }).count(), 0);
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await orb.click();
  await submit("Add title, trim the opening, lower music");
  let current = await snapshot();
  assert.equal(current.texts[0].text, "Summer sale");
  assert.equal(current.clips[0].in, 1);
  assert.equal(current.scene.musicGain, .25);
  assert.equal(current.past, 1, "Three native edits commit as one history entry");
  await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await snapshot()).texts.length, 0);
  assert.equal((await snapshot()).clips[0].in, 0);
  await checkMultiStepChoice();
  await checkNoopAndBlocked();
  await checkMixedAnswer();
  await checkConversationLifecycle();
  const outdated = holdResponse("Wait then edit", { message: "This outdated edit must be ignored.", observations: [],
    operations: [{ kind: "text.add", sceneId: "main", text: "Outdated response", start: 0, end: 2 }] });
  await orb.click();
  await field.fill("Wait then edit");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await phase("working").waitFor();
  await outdated.received;
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    useCapture.getState().edit({ ratio: "16:9" });
  });
  outdated.release();
  await page.locator('[data-notification-id="assistantProjectChanged"]').waitFor();
  assert.equal((await snapshot()).texts.length, 0, "A stale response cannot overwrite manual work");
  await page.keyboard.press("Escape");
  await phase("idle").waitFor();
  await checkProgressAndRetries("desktop");
  await checkTranscriptionAllowanceFailure();
  await page.screenshot({ path: "/tmp/pvo-native-assistant-original-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkProgressAndRetries("mobile");
  await orb.click();
  await submit("Describe this project", "answer");
  await page.waitForTimeout(550); // Finish the existing review entrance animation before layout inspection.
  const bounds = await review.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "/tmp/pvo-native-assistant-original-mobile.png" });
  await review.getByRole("button", { name: "Done", exact: true }).click();
  await orb.click();
  await submit("Add title on mobile");
  assert.equal((await snapshot()).texts.length, 1, "Mobile applies the same validated batch immediately");
  await page.locator('[data-notification-id="assistantApplied"]').getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await snapshot()).texts.length, 0);
  await orb.click();
  await field.fill("Prepare export");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal((await snapshot()).sheet, "export");
  assert.deepEqual(errors, []);
  console.log(`Native assistant browser passed: automatic routing, private multi-step edits, visible no-op answers, blocked-task rollback, atomic apply/Undo on both layouts, stale responses, progress/Stop, repeated 429 retries, transcription allowance failure and export handoff (${calls.length} fixture calls).`);
} finally { await browser.close(); }
