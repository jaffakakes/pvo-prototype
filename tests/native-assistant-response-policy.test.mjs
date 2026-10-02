import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeOperation, parseNativeTurnRequest, parseNativeTurnResult } from "../packages/pvo-assistant/native/index.js";
import { validateNativeResult } from "../server/assistant/native/policy.js";
import { cloudflareTurn, nativeFixture, nativeInput } from "./native-assistant-server.helpers.mjs";

const waitForAnswer = { dispatch: "layer_end", unanswered: "pause" };
const resultWith = operation => ({ message: "The quiz will wait for your answer.", operations: [operation], observations: [] });
const addChoice = () => ({ kind: "component.add", sceneId: "main", componentType: "choice",
  at: 0, duration: 2, responsePolicy: { ...waitForAnswer } });
const choiceContext = () => ({ id: "quiz", type: "choice", at: 0, duration: 5, x: 50, y: 50,
  scale: 1, scaleX: 1, scaleY: 1, proportionalScale: 1, width: null, height: null,
  label: "Guess the reveal", content: { prompt: "Guess the reveal" },
  responsePolicy: { dispatch: "interaction", unanswered: "continue" } });

test("native add and update preserve complete response policies and reject malformed or display-only policies", () => {
  for (const dispatch of ["interaction", "layer_end"]) for (const unanswered of ["continue", "pause"]) {
    const responsePolicy = { dispatch, unanswered };
    const add = { ...addChoice(), responsePolicy };
    const update = { kind: "component.update", sceneId: "main", componentId: "quiz", changes: { responsePolicy } };
    for (const operation of [add, update]) {
      assert.deepEqual(parseNativeOperation(operation), operation);
      const parsed = parseNativeTurnResult(resultWith(operation));
      assert.deepEqual(parsed.operations[0], operation);
      assert.notEqual(parsed.operations[0], operation, "Parsing isolates the operation from model input");
    }
  }
  for (const responsePolicy of [null, {}, { unanswered: "pause" }, { dispatch: "later", unanswered: "pause" },
    { dispatch: "interaction", unanswered: "stop" }, { ...waitForAnswer, timeout: 10 }]) {
    assert.throws(() => parseNativeOperation({ ...addChoice(), responsePolicy }), /responsePolicy/);
    assert.throws(() => parseNativeOperation({ kind: "component.update", sceneId: "main", componentId: "quiz",
      changes: { responsePolicy } }), /responsePolicy/);
  }
  const noteWithPolicy = { ...addChoice(), componentType: "tooltip" };
  assert.throws(() => parseNativeOperation(noteWithPolicy), /Notes cannot define/);
  assert.throws(() => parseNativeTurnResult(resultWith(noteWithPolicy)), /Notes cannot define/);
  const { responsePolicy: _policy, ...defaultChoice } = addChoice();
  assert.deepEqual(parseNativeOperation(defaultChoice), defaultChoice, "Omitting an add policy uses the editor's component default");
});

test("native context requires the actual policy for interactive components and excludes it from notes", () => {
  const request = nativeInput();
  for (const type of ["card", "choice", "form"]) {
    request.project.scenes[0].components = [{ ...choiceContext(), type }];
    const parsed = parseNativeTurnRequest(request);
    assert.deepEqual(parsed.project.scenes[0].components[0].responsePolicy, choiceContext().responsePolicy);
    delete request.project.scenes[0].components[0].responsePolicy;
    assert.throws(() => parseNativeTurnRequest(request), /context requires a response policy/);
  }
  const { responsePolicy: _policy, ...note } = { ...choiceContext(), type: "tooltip" };
  request.project.scenes[0].components = [note];
  assert.doesNotThrow(() => parseNativeTurnRequest(request));
  note.responsePolicy = waitForAnswer;
  assert.throws(() => parseNativeTurnRequest(request), /Notes cannot define/);
});

test("server rejects a policy update targeting a display-only note", async () => {
  const request = nativeInput();
  const { responsePolicy: _policy, ...note } = { ...choiceContext(), type: "tooltip" };
  request.project.scenes[0].components = [note];
  const result = resultWith({ kind: "component.update", sceneId: "main", componentId: note.id,
    changes: { responsePolicy: waitForAnswer } });
  await assert.rejects(validateNativeResult(request, result), /Notes cannot define/);
});

test("completion review sees the current non-pausing policy and retains a missing pause before the timed reveal", async () => {
  const request = nativeInput();
  request.prompt = "Pause the quiz before the reveal, wait for my guess, then resume the video.";
  request.project.scenes[0].components = [choiceContext()];
  request.observations = [{ kind: "transcript", sceneId: "main", start: 0, end: 5,
    text: "The lantern turns green.", segments: [{ start: 2.051, end: 3.586, text: "The lantern turns green." }] }];
  request.history = [{ role: "assistant", content: "The quiz already waits for a guess." }];
  const update = resultWith({ kind: "component.update", sceneId: "main", componentId: "quiz",
    changes: { at: 0, duration: 2, responsePolicy: waitForAnswer } });
  const calls = [];
  const actual = await cloudflareTurn(request, { signal: new AbortController().signal,
    ai: { run: async (_model, input) => {
      calls.push(input);
      return { response: calls.length === 1
        ? { message: "The quiz is already ready.", operations: [], observations: [] } : update };
    } },
  });
  assert.deepEqual(actual, update);
  assert.equal(calls.length, 2);
  const system = calls[0].messages[0].content;
  assert.match(system, /layer end \(at \+ duration\)/);
  assert.match(system, /decorative quiz overlay alone does not satisfy/);
  assert.doesNotMatch(system, /available native operations do not change that response policy/);
  const review = calls[1].messages.at(-1).content;
  assert.match(review, /check that unanswered is pause/);
  assert.ok(review.includes(JSON.stringify(request.prompt)));
  const currentLine = review.split("\n").find(line => line.startsWith("Current component values from the candidate project"));
  const [current] = JSON.parse(currentLine.slice(currentLine.indexOf(": ") + 2));
  assert.deepEqual(current.responsePolicy, { dispatch: "interaction", unanswered: "continue" });
  assert.equal(current.duration, 5, "A claimed pause in history does not alter current metadata");
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).observations, request.observations);
});

test("HTTP preserves a requested pause policy on a new quiz and on an existing quiz update", async t => {
  const add = resultWith(addChoice());
  const update = resultWith({ kind: "component.update", sceneId: "main", componentId: "quiz",
    changes: { at: 0, duration: 2, responsePolicy: waitForAnswer } });
  const fixture = await nativeFixture({ outputs: [{ response: add }, { response: update }] });
  t.after(fixture.close);
  const request = nativeInput();
  request.prompt = "Have the quiz pause at two seconds and resume after my guess.";
  const added = await fixture.turn(request);
  assert.equal(added.status, 200);
  assert.deepEqual(await added.json(), add);
  request.project.scenes[0].components = [choiceContext()];
  const updated = await fixture.turn(request);
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), update);
});

test("coarse multi-phrase speech remains unresolved through completion review until narrower inspection", async () => {
  const request = nativeInput();
  request.prompt = "Pause after the setup sentence and wait for a guess before the reveal is spoken.";
  request.project.scenes[0].components = [{ ...choiceContext(), at: 3, duration: 1, responsePolicy: waitForAnswer }];
  request.history = [{ role: "assistant", content: "The editor prepared a pause at four seconds, where the reveal begins." }];
  request.observations = [{ kind: "transcript", sceneId: "main", start: 0, end: 10,
    text: "The door looks ordinary. Behind it is a garden. The birds are singing.",
    segments: [{ start: 0.031, end: 9.982, text: "The door looks ordinary. Behind it is a garden. The birds are singing." }] }];
  const refine = { message: "I need to locate the transition between the setup and reveal more closely.",
    operations: [], observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 5 }] };
  const calls = [];
  const result = await cloudflareTurn(request, { signal: new AbortController().signal,
    ai: { run: async (_model, input) => {
      calls.push(input);
      return { response: calls.length === 1
        ? { message: "The quiz pauses before the reveal at four seconds.", operations: [], observations: [] }
        : refine };
    } },
  });
  assert.deepEqual(result, refine, "An observation can replace premature completion even after a pause was prepared");
  assert.equal(calls.length, 2);
  const system = calls[0].messages[0].content;
  assert.match(system, /start\/end bounds apply only to its entire text/);
  assert.match(system, /Never estimate an internal phrase's position from word order, word count, speaking speed or the sentence midpoint/);
  assert.match(system, /at most half the prior range before returning timing operations/);
  const review = calls[1].messages.at(-1).content;
  assert.match(review, /A prepared layer end or an earlier assistant claim is not speech evidence/);
  assert.match(review, /Do not move a guessed pause to another guessed time/);
  assert.match(review, /return blocked with the remaining uncertainty/);
  const timingLine = review.split("\n").find(line => line.startsWith("Current transcript timing metadata"));
  const [timing] = JSON.parse(timingLine.slice(timingLine.indexOf(": ") + 2));
  assert.deepEqual(timing, { sceneId: "main", start: 0, end: 10, segmentCount: 1,
    widestSegmentSeconds: 9.982 - 0.031 });
  assert.match(review, /User-specified absolute times and already isolated phrase\/word evidence do not require reinspection/);
  assert.deepEqual(request.project.scenes[0].components[0].responsePolicy, waitForAnswer,
    "Evidence guidance neither fabricates a new boundary nor mutates the candidate");
});
