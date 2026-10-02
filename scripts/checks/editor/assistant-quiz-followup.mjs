import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { parseNativeTurnRequest, parseNativeTurnResult } from "../../../packages/pvo-assistant/native/index.js";
import { installAssistantAvailabilityFixture, preparedAssistantReceipts } from "./assistant-fixture.mjs";

// Explicit provider replies isolate the client workflow. Compilation, candidate
// preparation, conversation retention, application and Undo remain real.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await installAssistantAvailabilityFixture(context);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const calls = [];
page.on("pageerror", error => errors.push(error.message));
const firstPrompt = "Make a quiz guessing the punchline and show the answer at the end.";
const followupPrompt = "Remove the opening spoiler, show the quiz only for the first five seconds, improve the question, and reveal the answer at 69 to 74 seconds. Keep all the footage.";
const punchline = "Because he was outstanding in his field.";
let beforeFollowup;
let choiceId;
let spoilerId;
const snapshot = () => page.evaluate(async () => {
  const { useCapture } = await import("/src/state/captureStore.ts");
  const state = useCapture.getState();
  return { scene: structuredClone(state.scenes[0]), past: state.past.length };
});
const conversation = () => page.evaluate(async () => {
  const { useAssistant } = await import("/src/state/assistant/assistantStore.ts");
  return structuredClone(useAssistant.getState().history);
});
const response = (message, operations = []) => parseNativeTurnResult({ message, operations, observations: [] });

await context.route("**/api/assistant/turn", async route => {
  try {
    const request = parseNativeTurnRequest(route.request().postDataJSON());
    calls.push(request);
    const receipts = preparedAssistantReceipts(request);
    const scene = request.project.scenes[0];
    assert.equal(scene.duration, 74);
    assert.equal(scene.clips.length, 1, "Model context retains the complete original footage");
    assert.equal(scene.clips[0].end, 74);
    assert.equal(request.mode, "plan");
    let reply;
    if (request.prompt === firstPrompt) {
      if (receipts.length === 0) {
        reply = response("Create the quiz and opening text.", [
          { kind: "component.add", sceneId: "main", componentType: "choice", at: 0, duration: 74 },
          { kind: "text.add", sceneId: "main", text: punchline, start: 0, end: 5 },
        ]);
      } else if (scene.components[0]?.content.prompt !== "Guess the punchline") {
        assert.equal(receipts.length, 2, "Creation and opening text have authoritative execution receipts");
        choiceId = scene.components[0].id;
        spoilerId = scene.texts[0].id;
        reply = response("Fill in the quiz choices.", [{
          kind: "component.content", sceneId: "main", componentId: choiceId,
          changes: { prompt: "Guess the punchline", optionLabels: [punchline, "Because he was very tall."] },
        }]);
      } else {
        assert.equal(receipts.length, 3, "Quiz content adds one further authoritative receipt");
        reply = response("The quiz is ready.");
      }
    } else {
      assert.equal(request.prompt, followupPrompt);
      assert.deepEqual(await snapshot(), beforeFollowup, "Every follow-up step stays private until completion");
      assert(request.history.some(item => item.role === "user" && item.content === firstPrompt));
      assert(request.history.some(item => item.role === "assistant" && item.content === "The quiz is ready."));
      assert(!request.history.some(item => /Create the quiz and opening text|Fill in the quiz choices/.test(item.content)),
        "An earlier request's in-progress messages cannot masquerade as the latest task");
      const choice = scene.components.find(item => item.id === choiceId);
      assert(choice?.source, "Follow-up context includes the existing quiz's actual editable source");
      if (receipts.length === 0) {
        assert.equal(choice.duration, 74);
        assert.equal(scene.texts[0].id, spoilerId);
        reply = response("Remove the spoiler and shorten the quiz.", [
          { kind: "text.delete", sceneId: "main", textId: spoilerId },
          { kind: "component.update", sceneId: "main", componentId: choiceId, changes: { at: 0, duration: 5 } },
        ]);
      } else if (choice.duration === 5 && scene.texts.length === 0) {
        assert.equal(receipts.length, 2, "Spoiler removal and quiz timing have authoritative receipts");
        assert.equal(choice.duration, 5, "The model sees the changed component timing on its next turn");
        assert.equal(scene.texts.length, 0, "Deleted spoiler is absent from the next candidate context");
        reply = response("Improve the question and add the final reveal.", [
          { kind: "component.content", sceneId: "main", componentId: choiceId,
            changes: { prompt: "Why did the scarecrow win an award?" } },
          { kind: "text.add", sceneId: "main", text: punchline, start: 69, end: 74 },
        ]);
      } else {
        assert.equal(receipts.length, 4, "Follow-up content and final reveal add two further receipts");
        assert.equal(choice.content.prompt, "Why did the scarecrow win an award?");
        assert.equal(choice.duration, 5);
        assert.equal(scene.texts.length, 1);
        assert.equal(scene.texts[0].start, 69);
        assert.equal(scene.texts[0].end, 74);
        assert.notEqual(scene.texts[0].id, spoilerId);
        reply = response("Removed the spoiler, shortened the quiz, and put the answer at the end.");
      }
    }
    await route.fulfill({ json: reply });
  } catch (error) {
    errors.push(String(error));
    await route.fulfill({ status: 500, json: { error: { message: "Fixture assertion failed." } } });
  }
});

async function submit(prompt) {
  await page.locator("[data-assistant-orb]").click();
  await page.getByRole("textbox", { name: "Describe a change", exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const notice = page.locator('[data-notification-id="assistantApplied"]');
  await notice.waitFor();
  await notice.hover();
  return notice;
}

try {
  await page.goto(process.env.EDITOR_URL || "http://127.0.0.1:5195/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { mkClip } = await import("/src/store.ts");
    useCapture.setState(initial());
    useCapture.getState().patch({ screen: "editor", clips: [mkClip(74, null, 0)], sound: 1, playing: false });
  });
  const original = await snapshot();
  const initialNotice = await submit(firstPrompt);
  beforeFollowup = await snapshot();
  assert.equal(beforeFollowup.past, original.past + 1);
  assert.equal(beforeFollowup.scene.components.length, 1);
  assert.deepEqual(beforeFollowup.scene.clips, original.scene.clips);
  await initialNotice.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  const firstHistory = await conversation();
  assert.deepEqual(firstHistory.filter(item => item.role === "user"), [{ role: "user", content: firstPrompt }]);
  assert(firstHistory.some(item => item.content === "The quiz is ready."));
  assert(!firstHistory.some(item => /not committed yet|Editor prepared/.test(item.content)));

  const notice = await submit(followupPrompt);
  const result = await snapshot();
  assert.equal(result.past, beforeFollowup.past + 1, "All four follow-up edits add only one Undo entry");
  assert.deepEqual(result.scene.clips, original.scene.clips, "Quiz corrections preserve every original media property");
  assert.equal(result.scene.components[0].id, choiceId, "The existing choice is edited rather than recreated");
  assert.equal(result.scene.components[0].at, 0);
  assert.equal(result.scene.components[0].dur, 5);
  assert.equal(result.scene.components[0].fields.prompt, "Why did the scarecrow win an award?");
  assert.equal(result.scene.texts.length, 1);
  assert.equal(result.scene.texts[0].start, 69);
  assert.equal(result.scene.texts[0].end, 74);
  const retained = await conversation();
  assert.deepEqual(retained.filter(item => item.role === "user").map(item => item.content), [firstPrompt, followupPrompt]);
  assert(!retained.some(item => /not committed yet|Editor prepared/.test(item.content)), "Only completed conversation remains");
  await notice.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(await snapshot(), beforeFollowup, "One Undo restores the exact pre-follow-up quiz, text, footage and history");
  assert.equal(calls.length, 6);
  assert.deepEqual(errors, []);
  console.log("PASS 74-second quiz follow-up: latest candidate context, spoiler deletion, timing/content correction, timed reveal, original footage, one Undo; provider responses are fixtures.");
} finally {
  await browser.close();
}
