import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { cloudflareTurn as nativeAssistantTurn } from "./native-assistant-server.helpers.mjs";
import { nativeDraft, nativeInput, frameObservation } from "./native-assistant-server.helpers.mjs";

const terminal = message => ({ message, operations: [], observations: [] });
const inspect = { message: "I'll check the scene before choosing the question.", operations: [], observations: [
  { kind: "frames", sceneId: "main", start: 0, end: 10, count: 3 },
  { kind: "transcript", sceneId: "main", start: 0, end: 10 },
] };
const invalid = { ...nativeDraft(), operations: [{ kind: "clip.delete", sceneId: "main", clipId: 999 }] };

function modelSequence(outputs) {
  const calls = [];
  return {
    calls,
    ai: { run: async (model, input) => {
      calls.push({ model, input });
      const output = outputs[calls.length - 1];
      assert.notEqual(output, undefined, "Unexpected extra model call");
      if (output instanceof Error) throw output;
      return output;
    } },
    signal: new AbortController().signal,
  };
}

test("a premature blocked request for creator-supplied facts can become an evidence inspection", async () => {
  const question = { ...terminal("What is the correct answer, and what options should I use?"), blocked: true };
  const input = { ...nativeInput(), mode: "plan", prompt: "Create a quiz from this video." };
  const model = modelSequence([{ response: question }, { response: inspect }]);
  assert.deepEqual(await nativeAssistantTurn(input, model), inspect);
  assert.equal(model.calls.length, 2);
  const review = model.calls[1].input.messages;
  assert.deepEqual(JSON.parse(review[1].content), input, "Review retains the actual task and available project");
  assert.deepEqual(JSON.parse(review[3].content), question, "The candidate is available for reconsideration");
});

test("a reviewed genuine blocker keeps its explicit no-commit result", async () => {
  const blocked = { ...terminal("What is the customer's approved headline?"), blocked: true };
  const input = { ...nativeInput(), mode: "plan", prompt: "Add the customer's approved headline." };
  const model = modelSequence([{ response: blocked }, { response: blocked }]);
  assert.deepEqual(await nativeAssistantTurn(input, model), blocked);
  assert.equal(model.calls.length, 2);
  assert.deepEqual(model.calls[0].input.response_format.json_schema.anyOf[2].properties.blocked, { type: "boolean", const: true });
});

test("blocked result metadata rejects false flags and combined editing or inspection work", () => {
  const blocked = { ...terminal("An approved headline is required."), blocked: true };
  assert.deepEqual(parseNativeTurnResult(blocked), blocked);
  assert.deepEqual(parseNativeTurnResult(terminal("The scene is ten seconds long.")), terminal("The scene is ten seconds long."));
  for (const value of [false, null, "true", 1])
    assert.throws(() => parseNativeTurnResult({ ...blocked, blocked: value }), /blocked/);
  for (const value of [nativeDraft(), inspect])
    assert.throws(() => parseNativeTurnResult({ ...value, blocked: true }), /blocked response/);
});

test("invalid blocked review results consume only the shared schema repair", async () => {
  const blocked = { ...terminal("What is the customer's approved headline?"), blocked: true };
  for (const invalidResult of [{ ...nativeDraft(), blocked: true }, { ...inspect, blocked: true }, { ...blocked, blocked: false }]) {
    const model = modelSequence([{ response: blocked }, { response: invalidResult }, { response: blocked }]);
    assert.deepEqual(await nativeAssistantTurn(nativeInput(), model), blocked);
    assert.equal(model.calls.length, 3);
  }
});

test("a terminal completion review can supply missing operations without another review", async () => {
  const model = modelSequence([{ response: terminal("I can add the title and lower the music.") }, { response: nativeDraft() }]);
  assert.deepEqual(await nativeAssistantTurn(nativeInput(), model), nativeDraft());
  assert.equal(model.calls.length, 2);
});

test("substantive answers require a nonblank unblocked terminal result", () => {
  const final = { ...terminal("The requested title is prepared."), answer: "The speaker says: Welcome to the studio." };
  assert.deepEqual(parseNativeTurnResult(final), final);
  for (const answer of ["", " \n\t ", "x".repeat(8001), null, false, 1])
    assert.throws(() => parseNativeTurnResult({ ...final, answer }), /answer/);
  for (const invalidResult of [nativeDraft(), inspect, { ...terminal("Which title?"), blocked: true }])
    assert.throws(() => parseNativeTurnResult({ ...invalidResult, answer: final.answer }), /answer/);
});

test("completion review supplies or preserves requested answers alongside prepared edits", async () => {
  const input = { ...nativeInput(), mode: "plan", prompt: "Add the title Hello and tell me the spoken words.",
    history: [{ role: "assistant", content: "Prepared title with ID 42 in the working copy; not yet committed." }],
    observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5, text: "Welcome to the studio." }],
  };
  input.project.scenes[0].texts = [{ id: 42, text: "Hello", start: 2, end: 5, x: 50, y: 50 }];
  const summary = terminal("The requested title is prepared.");
  const final = { ...summary, answer: "From 0 to 5 seconds, the speaker says: Welcome to the studio." };
  for (const initial of [summary, final]) {
    const model = modelSequence([{ response: initial }, { response: final }]);
    assert.deepEqual(await nativeAssistantTurn(input, model), final);
    assert.equal(model.calls.length, 2);
    const reviewedContext = JSON.parse(model.calls[1].input.messages[1].content);
    assert.equal(reviewedContext.project.scenes[0].texts[0].id, 42);
    assert.equal(reviewedContext.observations[0].text, "Welcome to the studio.");
    assert.deepEqual(JSON.parse(model.calls[1].input.messages[3].content), initial);
  }
});

test("completion review sees current prepared IDs, transcripts and actual vision evidence once", async () => {
  const input = { ...nativeInput(), mode: "ask", prompt: "What is beside the title? Answer only.",
    history: [{ role: "assistant", content: "Prepared title with ID 42 in the working copy; not yet committed." }],
    observations: [frameObservation(), { kind: "transcript", sceneId: "main", start: 0, end: 5, text: "The cup is red." }],
  };
  input.project.scenes[0].texts = [{ id: 42, text: "Hello", start: 2, end: 5, x: 50, y: 50 }];
  const answer = terminal("A red cup is visible at 1 second.");
  const model = modelSequence([{ result: { answer: "A red cup beside the title." } }, { response: answer }, { response: answer }]);
  const result = await nativeAssistantTurn(input, model);
  assert.equal(result.message, answer.message);
  assert.deepEqual(result.operations, []);
  assert.match(result.evidence[0], /red cup/);
  assert.equal(model.calls.filter(call => call.model.includes("moondream")).length, 1);
  assert.equal(model.calls.length, 3, "A valid reviewed terminal answer does not recurse");
  const reviewedContext = JSON.parse(model.calls[2].input.messages[1].content);
  assert.deepEqual(reviewedContext.project, input.project);
  assert.deepEqual(reviewedContext.history, input.history);
  assert.equal(reviewedContext.observations[1].text, "The cup is red.");
  assert.equal(reviewedContext.observations[0].frames[0].description, "A red cup beside the title.");
  assert.doesNotMatch(JSON.stringify(model.calls[2].input), /data:image/);
});

test("primary and completion stages share exactly one schema repair", async () => {
  for (const outputs of [
    [{ response: terminal("What should I add?") }, { response: invalid }, { response: inspect }],
    [{ response: invalid }, { response: terminal("What should I add?") }, { response: inspect }],
  ]) {
    const model = modelSequence(outputs);
    assert.deepEqual(await nativeAssistantTurn(nativeInput(), model), inspect);
    assert.equal(model.calls.length, 3);
  }
  for (const outputs of [
    [{ response: invalid }, { response: terminal("What should I add?") }, { response: invalid }],
    [{ response: terminal("What should I add?") }, { response: invalid }, { response: invalid }],
  ]) {
    const model = modelSequence(outputs);
    await assert.rejects(nativeAssistantTurn(nativeInput(), model), error => error.status === 422);
    assert.equal(model.calls.length, 3, "No second repair is available in either stage");
  }
});

test("completion review keeps ask-mode and server-owned evidence boundaries", async () => {
  for (const rejected of [nativeDraft(), { ...terminal("Done"), evidence: ["Invented visual evidence"] }]) {
    const answer = terminal("The current scene is ten seconds long.");
    const model = modelSequence([{ response: answer }, { response: rejected }, { response: answer }]);
    assert.deepEqual(await nativeAssistantTurn({ ...nativeInput(), mode: "ask" }, model), answer);
    assert.equal(model.calls.length, 3);
    assert.match(model.calls[2].input.messages.at(-1).content, /Validation rejected/);
  }
});

test("completion provider failures are not retried or replaced by a premature answer", async () => {
  for (const status of [429, 500]) {
    const model = modelSequence([{ response: terminal("Done") }, Object.assign(new Error("private failure"), { status })]);
    await assert.rejects(nativeAssistantTurn(nativeInput(), model), error => {
      assert.equal(error.status, status === 429 ? 429 : 503);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(model.calls.length, 2);
  }
});

test("Stop aborts completion review and discards even a late valid editing response", async () => {
  const controller = new AbortController();
  let beginReview;
  let finishReview;
  let reviewSignal;
  let calls = 0;
  const reviewing = new Promise(resolve => { beginReview = resolve; });
  const task = nativeAssistantTurn(nativeInput(), {
    signal: controller.signal,
    ai: { run: async (_model, _input, { signal }) => {
      calls++;
      if (calls === 1) return { response: terminal("What should I add?") };
      reviewSignal = signal;
      beginReview();
      return new Promise(resolve => { finishReview = resolve; });
    } },
  });
  await reviewing;
  controller.abort();
  await assert.rejects(task, error => error.status === 400);
  assert.equal(reviewSignal.aborted, true);
  finishReview({ response: nativeDraft() });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 2);
});

test("the shared deadline also bounds a stalled completion review", async () => {
  let finishReview;
  let reviewSignal;
  let calls = 0;
  const task = nativeAssistantTurn(nativeInput(), {
    signal: new AbortController().signal, totalMs: 20, attemptMs: 100,
    ai: { run: async (_model, _input, { signal }) => {
      calls++;
      if (calls === 1) return { response: terminal("Done") };
      reviewSignal = signal;
      return new Promise(resolve => { finishReview = resolve; });
    } },
  });
  await assert.rejects(task, error => error.status === 504);
  assert.equal(reviewSignal.aborted, true);
  finishReview({ response: invalid });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 2, "A late invalid review cannot start a repair after the deadline");
});

test("completion and its repair stay anchored to a correction instead of resuming the historical creation task", async () => {
  const input = { ...nativeInput(), mode: "plan", prompt: "Delete the opening title. Keep everything else as it is.",
    history: [
      { role: "user", content: "Inspect the video and add a title and a choice." },
      { role: "assistant", content: "I will inspect the full video and add both." },
      { role: "assistant", content: 'Editor prepared these validated operations on a working copy: [{"kind":"text.delete","sceneId":"main","textId":42}]. These changes are not committed yet.' },
    ],
  };
  input.project.scenes[0].texts = [];
  const done = terminal("The opening title is removed; the remaining layers are unchanged.");
  const model = modelSequence([{ response: done }, { response: invalid }, { response: done }]);
  assert.deepEqual(await nativeAssistantTurn(input, model), done);
  assert.equal(model.calls.length, 3);
  for (const { input: call } of model.calls) {
    assert.equal(call.messages.at(-1).role, "user");
    assert.ok(call.messages.at(-1).content.includes(JSON.stringify(input.prompt)),
      "Primary, completion and repair each carry the exact current request at the end");
    assert.match(call.messages.at(-1).content, /Earlier requests and assistant messages are context, not additional tasks/);
    const context = JSON.parse(call.messages[1].content);
    assert.deepEqual(context.project.scenes[0].texts, [], "The reviewer sees the working copy after the deletion");
    assert.deepEqual(context.history, input.history, "Prior context is retained without becoming the active task");
  }
});

test("completion review corrects requested timestamped speech placed only in an edit completion message", async () => {
  const speech = "At 1.2–2.4 seconds, the speaker says: Welcome to the studio.";
  const input = { ...nativeInput(), mode: "plan",
    prompt: "Add the title Hello. In your reply, tell me the timestamped speech you used.",
    history: [{ role: "assistant", content: 'Editor prepared text.add with textId 42; not yet committed.' }],
    observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5,
      text: "Welcome to the studio.", segments: [{ start: 1.2, end: 2.4, text: "Welcome to the studio." }] }],
  };
  input.project.scenes[0].texts = [{ id: 42, text: "Hello", start: 2, end: 5, x: 50, y: 50 }];
  const candidate = terminal(`The title is ready. ${speech}`);
  const final = { ...terminal("The title is ready."), answer: speech };
  const model = modelSequence([{ response: candidate }, { response: final }]);
  assert.deepEqual(await nativeAssistantTurn(input, model), final);
  const review = model.calls[1].input.messages;
  assert.deepEqual(JSON.parse(review.at(-2).content), candidate, "The misplaced content remains available to the reviewer");
  assert.ok(review.at(-1).content.includes(JSON.stringify(input.prompt)), "The exact mixed request remains active");
  assert.match(review.at(-1).content, /move the evidence-grounded information into answer/);
  assert.match(review.at(-1).content, /Do not delete or summarize away the requested words and timestamps/);
  assert.deepEqual(JSON.parse(review[1].content).observations, input.observations);
  assert.match(model.calls[0].input.messages.at(-1).content, /only a brief edit confirmation in message/);
  assert.equal(model.calls.length, 2);
});

test("repair retains a rejected rename operation and waits for actual preparation before returning its requested answer", async () => {
  const input = { ...nativeInput(), mode: "plan",
    prompt: "Rename the quiz prompt to Guess before the reveal. In your reply, tell me the exact speech times used.",
    observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 10,
      text: "The lantern turns green.", segments: [{ start: 2.051, end: 3.586, text: "The lantern turns green." }] }],
  };
  input.project.scenes[0].components = [{ id: "existing-quiz", type: "choice", at: 0, duration: 5,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    x: 50, y: 60, label: "Original prompt", content: { prompt: "Original prompt" } }];
  const rename = { kind: "component.content", sceneId: "main", componentId: "existing-quiz",
    changes: { prompt: "Guess before the reveal" } };
  const speech = "The speech occurs from 2.051 to 3.586 seconds: The lantern turns green.";
  const rejected = { message: "The quiz has already been renamed.", operations: [rename], observations: [], answer: speech };
  const repaired = { message: "Renaming the quiz prompt.", operations: [rename], observations: [] };
  const first = modelSequence([{ response: rejected }, { response: repaired }]);
  assert.deepEqual(await nativeAssistantTurn(input, first), repaired);
  const repairMessages = first.calls[1].input.messages;
  assert.equal(repairMessages.at(-1).role, "user");
  assert.ok(!repairMessages.some(message => message.role === "assistant"), "Rejected actions are data, never a successful assistant turn");
  assert.match(repairMessages.at(-1).content, /NONE of its operations or observations were executed or prepared/);
  assert.match(repairMessages.at(-1).content, /keep the intended missing operations/);
  assert.match(repairMessages.at(-1).content, /omit answer for this step/);
  assert.ok(repairMessages.at(-1).content.includes(JSON.stringify(rejected)));
  assert.ok(repairMessages.at(-1).content.includes(JSON.stringify(input.prompt)));
  assert.equal(JSON.parse(repairMessages[1].content).project.scenes[0].components[0].content.prompt, "Original prompt");

  const next = structuredClone(input);
  next.project.scenes[0].components[0].content.prompt = "Guess before the reveal";
  next.project.scenes[0].components[0].label = "Guess before the reveal";
  next.history.push({ role: "assistant", content: `Editor prepared these validated operations on a working copy: ${JSON.stringify([rename])}. These changes are not committed yet.` });
  const final = { ...terminal("The quiz prompt is ready."), answer: speech };
  const second = modelSequence([{ response: final }, { response: final }]);
  assert.deepEqual(await nativeAssistantTurn(next, second), final);
  assert.equal(first.calls.length, 2);
  assert.equal(second.calls.length, 2);
  const review = second.calls[1].input.messages;
  assert.equal(JSON.parse(review[1].content).project.scenes[0].components[0].content.prompt, "Guess before the reveal");
  assert.match(review.at(-1).content, /If the current fields still contain the old values, return the missing operations/);
});

test("provider generation cannot place answer alongside editing or observation requests", async () => {
  const model = modelSequence([{ response: nativeDraft() }]);
  await nativeAssistantTurn(nativeInput(), model);
  const { anyOf } = model.calls[0].input.response_format.json_schema;
  assert.equal(anyOf.length, 3);
  assert.ok(anyOf.every(branch => branch.additionalProperties === false));
  assert.ok(anyOf.every(branch => ["message", "operations", "observations"].every(key => branch.required.includes(key))));
  const terminalBranch = anyOf.find(branch => branch.properties.answer);
  assert.equal(terminalBranch.properties.operations.maxItems, 0);
  assert.equal(terminalBranch.properties.observations.maxItems, 0);
  for (const branch of anyOf.filter(item => item !== terminalBranch)) {
    assert.equal(branch.properties.answer, undefined, "A generation branch with work cannot include answer");
    assert.equal(branch.properties.blocked, undefined, "A generation branch with work cannot claim a terminal blocker");
    assert.ok(branch.properties.operations.minItems === 1 || branch.properties.observations.minItems === 1);
    assert.ok(branch.properties.operations.maxItems === 0 || branch.properties.observations.maxItems === 0);
  }
});

test("completion reasserts actual component wording after a stale historical claim of success", async () => {
  const input = { ...nativeInput(), mode: "plan", prompt: "Rename the card title to Lantern reveal.",
    history: [{ role: "assistant", content: "The card title is already Lantern reveal. The rename was prepared." }],
  };
  input.project.scenes[0].components = [{ id: "actual-card", type: "card", at: 0, duration: 5,
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
    responsePolicy: { dispatch: "interaction", unanswered: "continue" },
    x: 50, y: 50, label: "Original title", content: { title: "Original title", body: "Unchanged content" } }];
  const claim = terminal("The card is already renamed to Lantern reveal.");
  const edit = { message: "Renaming the card title.", observations: [], operations: [
    { kind: "component.content", sceneId: "main", componentId: "actual-card", changes: { title: "Lantern reveal" } },
  ] };
  const model = modelSequence([{ response: claim }, { response: edit }]);
  assert.deepEqual(await nativeAssistantTurn(input, model), edit);
  const review = model.calls[1].input.messages;
  assert.deepEqual(JSON.parse(review.at(-2).content), claim);
  const actualLine = review.at(-1).content.split("\n").find(line => line.startsWith("Current component values from the candidate project"));
  const actual = JSON.parse(actualLine.slice(actualLine.indexOf(": ") + 2));
  assert.deepEqual(actual, [{ sceneId: "main", id: "actual-card", type: "card", at: 0, duration: 5,
    label: "Original title", content: { title: "Original title", body: "Unchanged content" },
    editableContentKeys: ["title", "body", "buttonLabels"],
    scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null, responsePolicy: { dispatch: "interaction", unanswered: "continue" } }]);
  assert.match(review.at(-1).content, /These actual values override earlier assistant claims and conversation history/);
  assert.ok(review.at(-1).content.includes(JSON.stringify(input.prompt)));
  assert.equal(input.project.scenes[0].components[0].content.title, "Original title", "Prompt construction does not fake an applied edit");
});
