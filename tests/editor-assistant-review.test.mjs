import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: `export { useCapture, mkClip } from "./editor/src/store.ts";
      export { initial } from "./editor/src/state/project/initial.ts";
      export { projectSnapshot } from "./editor/src/state/project/history.ts";
      export { assistantSource, assistantReviewRequest, createAssistantReview, matchesAssistantTarget } from "./editor/src/domain/assistant/review.ts";
      export { keepAssistantReview } from "./editor/src/state/assistant/assistantCommands.ts";
      export { useEditorPreferences } from "./editor/src/state/preferences/editorPreferences.ts";
      export { useAssistant, resetAssistant } from "./editor/src/state/assistant/assistantStore.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { useCapture, mkClip, initial, projectSnapshot, assistantSource, assistantReviewRequest, createAssistantReview, useEditorPreferences,
  matchesAssistantTarget, keepAssistantReview, useAssistant, resetAssistant } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const plain = value => JSON.parse(JSON.stringify(value));
const selected = () => useCapture.getState().components.find(component => component.id === useCapture.getState().selComp);
const saved = () => {
  const state = useCapture.getState();
  return plain({ project: projectSnapshot(state), past: state.past, future: state.future });
};

function start() {
  const state = initial();
  state.scenes[0].clips = [mkClip(8, null, 0)];
  state.clips = state.scenes[0].clips;
  useCapture.setState(state);
  resetAssistant();
  const id = useCapture.getState().addComponent("choice");
  useCapture.getState().updateComponent(id, { x: 41, y: 57, scale: 1.25, at: 2 });
  return selected();
}

function proposal(component, action = { kind: "continue" }) {
  const source = assistantSource(component);
  return {
    mode: "preview", label: "Local preview", summary: "A larger heading", tags: ["PVO Style"],
    followUps: ["Softer colours", "Larger heading", "Bolder"],
    source: { ...source, style: `${source.style}\nprompt { font-size: 24px; }` },
    compiled: {
      structure: { type: "choice", prompt: component.fields.prompt,
        options: component.fields.options.map((option, index) => ({ id: `option${index}`, label: option.label })) },
      rules: [0, 1].map(index => ({ event: "choose", target: `option${index}`, action: structuredClone(action) })),
    },
  };
}

test("review, Before, and discarding a proposal leave the project and undo/redo untouched", () => {
  const original = start();
  useCapture.getState().updateComponent(original.id, { x: 60 });
  useCapture.getState().undo();
  const before = saved();
  const review = createAssistantReview(selected(), proposal(selected()), "Larger heading");
  assert.notEqual(review.original, selected());
  assert.notEqual(review.proposed.fields.options, selected().fields.options);
  assert.notEqual(review.proposed.code.pvoCompiled, review.proposal.compiled);
  useAssistant.setState({ phase: "review", review });
  useAssistant.setState({ before: true });
  useAssistant.setState({ before: false });
  resetAssistant();
  assert.deepEqual(saved(), before);
  assert.ok(before.future.length, "The fixture retains a real redo branch");
  assert.equal(selected().code, undefined);
});

test("review keeps the original request and folds stacked follow-ups into one editable line", () => {
  const original = start();
  const review = createAssistantReview(original, proposal(original), "Make it blue", ["Larger heading", "Bolder"], ["Skipped: shadow."]);
  assert.equal(review.request, "Make it blue");
  assert.deepEqual(review.tags, ["Larger heading", "Bolder"]);
  assert.equal(assistantReviewRequest(review), "Make it blue; Larger heading; Bolder");
  assert.deepEqual(review.changes, { style: 1, structure: 0, logic: 0 });
  assert.deepEqual(review.skipped, ["Skipped: shadow."]);
});

test("Keep synchronizes content, actions, Look and exact PVO in one undoable edit", () => {
  const original = start();
  const before = saved();
  const proposed = proposal(original, { kind: "time", t: 3 });
  proposed.source.style += "\nchoice { background: #123456; }";
  proposed.source.structure = proposed.source.structure.replace(/<prompt>.*?<\/prompt>/s, "<prompt>Choose your next scene</prompt>");
  proposed.source.logic = "on choose(option0) { jump_to(3); }\non choose(option1) { jump_to(3); }";
  proposed.compiled.structure.prompt = "Choose your next scene";
  const review = createAssistantReview(original, proposed, "Rewrite the prompt and make it blue");
  assert.equal(keepAssistantReview(review), true);
  const after = saved();
  assert.equal(after.past.length, before.past.length + 1);
  assert.equal(selected().code.custom, true);
  assert.equal(selected().code.pvoTouched, false, "A compiled AI result is immediately editable through visual controls");
  assert.deepEqual(selected().code.pvo, review.proposal.source);
  assert.deepEqual(selected().code.pvoLastValid, review.proposal.source);
  assert.deepEqual(selected().code.pvoCompiled, review.proposal.compiled);
  assert.equal(selected().fields.prompt, "Choose your next scene");
  assert.deepEqual(selected().fields.options.map(option => option.outcome), [{ kind: "time", t: 3 }, { kind: "time", t: 3 }]);
  assert.equal(selected().look.whole.bg.toUpperCase(), "#123456");
  for (const key of ["id", "sceneId", "type", "x", "y", "scale", "at", "dur", "hold"])
    assert.deepEqual(selected()[key], original[key], `Keep preserves ${key}`);
  assert.deepEqual(after.project.scenes[0].layers, before.project.scenes[0].layers);
  assert.equal(keepAssistantReview(review), false, "An already-applied proposal cannot add a second undo step");
  assert.deepEqual(saved(), after);
  useCapture.getState().undo();
  assert.deepEqual(plain(projectSnapshot(useCapture.getState())), before.project);
  assert.equal(selected().code, undefined);
  useCapture.getState().redo();
  assert.deepEqual(plain(projectSnapshot(useCapture.getState())), after.project);
});

test("Keep refuses changed, deselected, deleted, and different-scene targets", () => {
  for (const change of [
    original => useCapture.getState().updateComponent(original.id, { scale: 2 }),
    () => useCapture.getState().patch({ selComp: null }),
    original => useCapture.getState().deleteComponent(original.id),
    () => useCapture.getState().createScene({ name: "Other" }),
  ]) {
    const original = start();
    const review = createAssistantReview(original, proposal(original), "Larger heading");
    change(original);
    const before = saved();
    assert.equal(keepAssistantReview(review), false);
    assert.deepEqual(saved(), before);
  }
});

test("Keep revalidates current scene routes and times without committing invalid proposals", () => {
  for (const action of [
    { kind: "time", t: 8.1 },
    { kind: "scene", sceneId: "missing" },
    { kind: "request", url: "https://example.com", method: "GET", body: "",
      onSuccess: { kind: "continue" }, onError: { kind: "time", t: 99 } },
  ]) {
    const original = start();
    if (action.kind === "request") useCapture.getState().patch({ allowedDomains: ["example.com"] });
    const review = createAssistantReview(original, proposal(original, action), "Change destination");
    const before = saved();
    assert.throws(() => keepAssistantReview(review), /outside|empty or missing/);
    assert.deepEqual(saved(), before);
  }
  const original = start();
  const review = createAssistantReview(original, proposal(original, { kind: "time", t: 7 }), "Jump later");
  useCapture.getState().updateScene(original.sceneId, { clips: [mkClip(4, null, 0)] });
  const before = saved();
  assert.throws(() => keepAssistantReview(review), /outside/);
  assert.deepEqual(saved(), before, "A once-valid route cannot outlive a timeline edit");
});

test("assistant source follows Fields/code ownership and escapes resolved tokens", () => {
  const original = start();
  original.fields.prompt = 'Text <tag> & "quotes"';
  const generated = assistantSource(original);
  assert.match(generated.structure, /Text &lt;tag&gt; &amp; &quot;quotes&quot;/);
  assert.doesNotMatch(generated.structure, /\{\{/);
  const savedDraft = { structure: "<choice>stale draft</choice>", style: "stale", logic: "stale" };
  assert.deepEqual(assistantSource({ ...original, code: { custom: false, pvo: savedDraft } }), generated);
  const custom = { ...generated, structure: generated.structure.replace("Text &lt;tag&gt;", "Authored"), style: "choice { color: #fff; }" };
  assert.deepEqual(assistantSource({ ...original, code: { custom: true, pvo: custom } }), custom);
  assert.throws(() => assistantSource({ ...original, code: { custom: true } }), /retired code.*Reset/);
});

test("Keep rejects a new or revoked request host and accepts an existing project destination", () => {
  const original = start();
  const action = { kind: "request", url: "https://api.example.com/submit", method: "POST",
    body: "{}", onSuccess: { kind: "continue" }, onError: null };
  const review = createAssistantReview(original, proposal(original, action), "Use this destination");
  const before = saved();
  assert.throws(() => keepAssistantReview(review), /Add this request destination/);
  assert.deepEqual(saved(), before);
  useCapture.getState().patch({ allowedDomains: ["api.example.com"] });
  useCapture.getState().patch({ allowedDomains: [] });
  const revoked = saved();
  assert.throws(() => keepAssistantReview(review), /Add this request destination/);
  assert.deepEqual(saved(), revoked, "A removed destination cannot be restored implicitly by Keep");
  useCapture.getState().patch({ allowedDomains: ["api.example.com"] });
  const allowed = saved();
  assert.throws(() => keepAssistantReview(review), error => error.code === "advanced_required",
    "An allowed destination does not override the current no-code logic boundary");
  assert.deepEqual(saved(), allowed, "A blocked Keep preserves project and both history stacks");
  useEditorPreferences.setState({ advancedEditingEnabled: true });
  assert.equal(keepAssistantReview(review), true);
  useEditorPreferences.setState({ advancedEditingEnabled: false });
  assert.equal(useCapture.getState().past.length, allowed.past.length + 1);
  assert.deepEqual(useCapture.getState().allowedDomains, ["api.example.com"]);
});

test("Keep rechecks a disabled Advanced switch, while appearance edits remain allowed", () => {
  const original = start();
  useEditorPreferences.setState({ advancedEditingEnabled: true });
  useCapture.getState().patch({ allowedDomains: ["example.com"] });
  const advanced = createAssistantReview(original, proposal(original, { kind: "request", url: "https://example.com",
    method: "GET", body: "", onSuccess: { kind: "continue" }, onError: null }), "Change behavior");
  useEditorPreferences.setState({ advancedEditingEnabled: false });
  const before = saved();
  assert.throws(() => keepAssistantReview(advanced), error => error.code === "advanced_required");
  assert.deepEqual(saved(), before);
  const visual = createAssistantReview(original, proposal(original), "Custom heading size");
  assert.equal(keepAssistantReview(visual), true);
  assert.match(selected().code.pvo.style, /24px/);
  assert.equal(useCapture.getState().past.length, before.past.length + 1);
  useCapture.getState().undo();
  assert.deepEqual(plain(projectSnapshot(useCapture.getState())), before.project);
});

test("an existing PVO component retains its exact authored source through Keep and undo", () => {
  const original = start();
  const source = assistantSource(original);
  source.style = "choice { color: #abc; }\n\n";
  useCapture.getState().updateComponent(original.id, { code: { custom: true, pvoTouched: true,
    pvo: source, pvoCompiled: proposal(original).compiled } });
  const before = selected();
  const review = createAssistantReview(before, proposal(before), "Larger heading");
  assert.equal(matchesAssistantTarget(review.original, before), true);
  assert.equal(matchesAssistantTarget(review.original, undefined), false);
  assert.equal(keepAssistantReview(review), true);
  useCapture.getState().undo();
  assert.deepEqual(plain(selected()), plain(before));
  assert.equal(selected().code.pvo.style, "choice { color: #abc; }\n\n");
});
