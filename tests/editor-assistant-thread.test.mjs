import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { projectSnapshot } from "./editor/src/state/project/history.ts";
      export { assistantSource, createAssistantReview } from "./editor/src/domain/assistant/review.ts";
      export { createAssistantThreadPatch, applyAssistantThreadPatch } from "./editor/src/domain/assistant/threadPatch.ts";
      export { keepAssistantReview } from "./editor/src/state/assistant/assistantCommands.ts";
      export { useAssistant, resetAssistant } from "./editor/src/state/assistant/assistantStore.ts";
      export * from "./editor/src/state/assistant/threadStore.ts";
      export * from "./editor/src/state/assistant/threadCommands.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const {
  useCapture, mkClip, initial, projectSnapshot, assistantSource, createAssistantReview,
  createAssistantThreadPatch, applyAssistantThreadPatch, keepAssistantReview,
  useAssistantThread, resetAssistantThread, setAssistantThreadOpen, setAssistantThreadCollapsed,
  setAssistantThreadDraft, startAssistantExchange, refineAssistantExchange,
  proposeAssistantExchange, applyAssistantExchange, finishAssistantExchange,
  assistantExchangeAvailability, toggleAssistantExchange, showAssistantExchange, dismissAssistantThread,
  useAssistant, resetAssistant,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const plain = value => JSON.parse(JSON.stringify(value));
const component = id => useCapture.getState().scenes.flatMap(scene => scene.components).find(item => item.id === id);
const exchange = id => useAssistantThread.getState().items.find(item => item.id === id);
const saved = () => {
  const state = useCapture.getState();
  return plain({ project: projectSnapshot(state), past: state.past, future: state.future });
};

function start() {
  const state = initial();
  state.localId = crypto.randomUUID();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  resetAssistantThread();
  const id = useCapture.getState().addComponent("choice");
  useCapture.getState().updateComponent(id, { at: 2 });
  return component(id);
}

function reviewFor(original) {
  const source = assistantSource(original);
  return createAssistantReview(original, {
    mode: "preview", label: "Local preview", summary: "Made the heading larger.", tags: ["PVO Style"],
    followUps: ["Softer colours", "Larger heading", "Bolder"],
    source: { ...source, style: `${source.style}\nprompt { font-size: 24px; }` },
    compiled: {
      structure: { type: "choice", prompt: original.fields.prompt,
        options: original.fields.options.map((option, index) => ({ id: `option${index}`, label: option.label })) },
      rules: [0, 1].map(index => ({ event: "choose", target: `option${index}`, action: { kind: "continue" } })),
    },
  }, "Larger heading");
}

function apply(original) {
  const id = startAssistantExchange({ request: "Larger heading", at: 2,
    target: { sceneId: original.sceneId, componentId: original.id } });
  const review = reviewFor(original);
  proposeAssistantExchange(id, review);
  assert.equal(keepAssistantReview(review), true);
  assert.equal(applyAssistantExchange(id, review), true);
  return id;
}

test("pending requests, refinements and failures retain the user's request without touching project history", () => {
  const original = start();
  const before = saved();
  const id = startAssistantExchange({ request: "Make it larger", at: 2,
    target: { sceneId: original.sceneId, componentId: original.id } });
  assert.equal(exchange(id).pending, true);
  assert.equal(exchange(id).you, "Make it larger");
  proposeAssistantExchange(id, reviewFor(original));
  assert.equal(exchange(id).status, "proposed");
  assert.deepEqual(exchange(id).changes, [{ label: "Style updated", tone: "ok" }]);
  assert.equal(assistantExchangeAvailability(exchange(id)).canUndo, false);
  refineAssistantExchange(id, "Make it larger; softer colours");
  assert.equal(exchange(id).pending, true);
  assert.equal(exchange(id).you, "Make it larger; softer colours");
  finishAssistantExchange(id, "failed", "Restyle couldn't complete this request.");
  assert.equal(exchange(id).status, "failed");
  assert.equal(exchange(id).pending, false);
  assert.equal(useAssistantThread.getState().items.length, 1);
  assert.deepEqual(saved(), before);
});

test("opening pauses playback while closing remembers collapse, draft, selection and time", () => {
  const original = start();
  useCapture.getState().patch({ playing: true, t: 3 });
  setAssistantThreadCollapsed(true);
  setAssistantThreadDraft("Make it blue");
  setAssistantThreadOpen(true);
  assert.equal(useCapture.getState().playing, false);
  setAssistantThreadOpen(false);
  assert.equal(useAssistantThread.getState().collapsed, true);
  assert.equal(useAssistantThread.getState().draft, "Make it blue");
  assert.equal(useCapture.getState().selComp, original.id);
  assert.equal(useCapture.getState().t, 3);
});

test("a failed refinement restores the actual proposed request before that proposal is kept", () => {
  const original = start();
  const id = startAssistantExchange({ request: "Larger heading", at: 2,
    target: { sceneId: original.sceneId, componentId: original.id } });
  const review = reviewFor(original);
  review.tags.push("Bolder");
  proposeAssistantExchange(id, review);
  refineAssistantExchange(id, "Larger heading; Bolder; unsupported refinement");
  assert.equal(exchange(id).pending, true);
  proposeAssistantExchange(id, review);
  assert.equal(exchange(id).you, "Larger heading; Bolder");
  assert.equal(exchange(id).pending, false);
  assert.equal(keepAssistantReview(review), true);
  assert.equal(applyAssistantExchange(id, review), true);
  assert.equal(exchange(id).you, "Larger heading; Bolder");
});

test("an older exchange Undo preserves later edits and contributes one normal history entry", () => {
  const original = start();
  const id = apply(original);
  const applied = plain(component(original.id));
  useCapture.getState().updateComponent(original.id, { x: 73, at: 3 });
  const other = useCapture.getState().addComponent("tooltip");
  useCapture.getState().updateComponent(other, { fields: { text: "Keep this later edit" } });
  const neighbor = plain(component(other));
  const count = useCapture.getState().past.length;
  assert.deepEqual(toggleAssistantExchange(id), { ok: true });
  assert.equal(useCapture.getState().past.length, count + 1);
  assert.equal(exchange(id).undone, true);
  assert.equal(component(original.id).x, 73);
  assert.equal(component(original.id).at, 3);
  assert.deepEqual(plain(component(original.id).fields), plain(original.fields));
  assert.deepEqual(plain(component(original.id).look), plain(original.look));
  assert.equal(component(original.id).code, original.code);
  assert.deepEqual(plain(component(other)), neighbor);
  assert.equal(useCapture.getState().selComp, other);
  assert.deepEqual(toggleAssistantExchange(id), { ok: true });
  assert.equal(exchange(id).undone, false);
  assert.deepEqual(plain(component(original.id).code), applied.code);
  assert.equal(component(original.id).x, 73);
  assert.deepEqual(plain(component(other)), neighbor);
});

test("global Undo and Redo synchronize thread rows, including undoing a targeted inverse", () => {
  const original = start();
  const id = apply(original);
  useCapture.getState().undo();
  assert.equal(exchange(id).undone, true);
  assert.equal(assistantExchangeAvailability(exchange(id)).canRedo, true);
  useCapture.getState().redo();
  assert.equal(exchange(id).undone, false);
  assert.equal(assistantExchangeAvailability(exchange(id)).canUndo, true);
  assert.equal(toggleAssistantExchange(id).ok, true);
  assert.equal(exchange(id).undone, true);
  useCapture.getState().undo();
  assert.equal(exchange(id).undone, false);
  useCapture.getState().redo();
  assert.equal(exchange(id).undone, true);
});

test("overlapping later source edits reject the whole inverse without clobbering anything", () => {
  const original = start();
  const id = apply(original);
  const current = component(original.id);
  useCapture.getState().updateComponent(original.id, { fields: { ...current.fields, prompt: "A later question" } });
  const before = saved();
  const availability = assistantExchangeAvailability(exchange(id));
  assert.equal(availability.canUndo, false);
  assert.equal(availability.canShow, true);
  assert.match(availability.message, /overlaps a later edit/);
  assert.equal(toggleAssistantExchange(id).ok, false);
  assert.deepEqual(saved(), before);
  assert.match(exchange(id).error, /overlaps a later edit/);
  useCapture.getState().undo();
  assert.equal(assistantExchangeAvailability(exchange(id)).canUndo, true);
  assert.equal(toggleAssistantExchange(id).ok, true);
});

test("Show navigates to the current target time across scenes without consuming a redo branch", () => {
  const original = start();
  const id = apply(original);
  useCapture.getState().updateComponent(original.id, { at: 3 });
  useCapture.getState().updateComponent(original.id, { x: 75 });
  useCapture.getState().undo();
  const newScene = { ...useCapture.getState().scenes[0], id: "other", name: "Other", parent: "main", components: [] };
  useCapture.getState().patch({ scenes: [...useCapture.getState().scenes, newScene], currentSceneId: "other", t: 0 });
  const history = plain({ past: useCapture.getState().past, future: useCapture.getState().future });
  assert.equal(showAssistantExchange(id).ok, true);
  const state = useCapture.getState();
  assert.equal(state.currentSceneId, original.sceneId);
  assert.equal(state.selComp, original.id);
  assert.equal(state.t, 3);
  assert.deepEqual(plain({ past: state.past, future: state.future }), history);
});

test("deleted targets remain deleted and exchange actions respect active operation boundaries", () => {
  const original = start();
  const id = apply(original);
  useCapture.getState().patch({ importing: true });
  const before = saved();
  assert.equal(showAssistantExchange(id).ok, false);
  assert.equal(toggleAssistantExchange(id).ok, false);
  assert.deepEqual(saved(), before);
  useCapture.getState().patch({ importing: false });
  useCapture.getState().deleteComponent(original.id);
  const deleted = saved();
  assert.equal(showAssistantExchange(id).ok, false);
  assert.equal(toggleAssistantExchange(id).ok, false);
  assert.deepEqual(saved(), deleted);
  assert.equal(component(original.id), undefined);
});

test("switching project identity clears the session, pending requests and remembered presentation", () => {
  const original = start();
  const id = startAssistantExchange({ request: "Larger heading", at: 0 });
  setAssistantThreadOpen(true);
  setAssistantThreadCollapsed(true);
  setAssistantThreadDraft("A draft for the first project");
  useCapture.getState().patch({ localId: "another-project" });
  assert.deepEqual(useAssistantThread.getState(), {
    projectId: "another-project", items: [], open: false, collapsed: false, draft: "",
  });
  proposeAssistantExchange(id, reviewFor(original));
  finishAssistantExchange(id, "cancelled", "Cancelled.");
  assert.deepEqual(useAssistantThread.getState().items, [], "Late request results cannot leak into the next project");
});

test("inverse patches preserve untouched nested values and treat ordered control arrays atomically", () => {
  const original = start();
  const proposed = structuredClone(original);
  proposed.fields.prompt = "New question";
  proposed.fields.options[0].label = "New label";
  const patch = createAssistantThreadPatch(original, proposed);
  const later = structuredClone(proposed);
  later.fields.body = "An unrelated later value";
  const undone = applyAssistantThreadPatch(later, patch, "undo");
  assert.equal(undone.fields.prompt, original.fields.prompt);
  assert.equal(undone.fields.body, "An unrelated later value");
  later.fields.options.reverse();
  assert.equal(applyAssistantThreadPatch(later, patch, "undo"), null,
    "Reordered controls cannot receive an inverse intended for their old positions");
});

test("every dismissal preserves pending work and explicit review while clearing listening input", () => {
  const original = start();
  const id = startAssistantExchange({ request: "Larger heading", at: 2,
    target: { sceneId: original.sceneId, componentId: original.id } });
  setAssistantThreadDraft("A later draft");
  setAssistantThreadCollapsed(true);
  setAssistantThreadOpen(true);
  useAssistant.setState({ phase: "working" });
  const before = saved();
  dismissAssistantThread();
  assert.equal(useAssistantThread.getState().open, false);
  assert.equal(useAssistant.getState().phase, "working");
  assert.equal(exchange(id).pending, true);
  assert.equal(useAssistantThread.getState().draft, "A later draft");
  assert.equal(useAssistantThread.getState().collapsed, true);
  assert.deepEqual(saved(), before);

  const review = reviewFor(original);
  useAssistant.setState({ phase: "review", review });
  dismissAssistantThread();
  assert.equal(useAssistant.getState().review, review, "Closing cannot discard an explicit review");
  setAssistantThreadOpen(true);
  useAssistant.setState({ phase: "listening", transcript: "Unsent words", review: null });
  dismissAssistantThread();
  assert.equal(useAssistant.getState().phase, "idle");
  assert.equal(useAssistant.getState().transcript, "");
  assert.equal(useCapture.getState().selComp, original.id);
  assert.deepEqual(saved(), before);
  resetAssistant();
});
