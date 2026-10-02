import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: 'export * from "./editor/src/infrastructure/projectPersistence/checkpoint.ts"; export { initial } from "./editor/src/state/project/initial.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { captureCheckpoint, referencedMedia, restoreCheckpoint, storeCheckpoint, validateCheckpoint, initial } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const clip = (id, url) => ({
  id, url, color: "#FF758F", srcDur: 3, in: 0, out: 3,
  speed: 1, zoom: 1, mirror: false, width: 1080, height: 1920, fit: "contain",
});
const scene = (clips, components = []) => ({
  id: "main", name: "Main", clips, texts: [], components, muted: false, sound: 0,
});
const choice = () => ({
  id: "choice", type: "choice", sceneId: "main", at: 0, dur: 2, x: 50, y: 50,
  responsePolicy: { dispatch: "interaction", unanswered: "continue" },
  fields: { prompt: "Choose", options: [
    { label: "A", outcome: { kind: "continue" } },
    { label: "B", outcome: { kind: "continue" } },
  ] },
});

test("checkpoint keeps every undoable clip Blob reference only once", () => {
  const state = initial();
  state.scenes = [scene([clip(1, "blob:current")])];
  state.clips = state.scenes[0].clips;
  state.past = [{ scenes: [scene([clip(2, "blob:deleted")])], currentSceneId: "main", ratio: "9:16", allowedDomains: [] }];
  state.future = [{ scenes: [scene([clip(1, "blob:current")])], currentSceneId: "main", ratio: "9:16", allowedDomains: [] }];
  const draft = captureCheckpoint(state);
  assert.deepEqual(referencedMedia(draft), ["blob:current", "blob:deleted"]);
  state.scenes[0].clips[0].out = 1;
  assert.equal(draft.project.scenes[0].clips[0].out, 3);
});

test("restore rewrites media URLs across current project and undo history", () => {
  const state = initial();
  state.scenes = [scene([clip(1, "blob:current")])];
  state.clips = state.scenes[0].clips;
  state.past = [{ scenes: [scene([clip(2, "blob:deleted")])], currentSceneId: "main", ratio: "4:5", allowedDomains: ["example.com"] }];
  const draft = captureCheckpoint(state);
  const record = storeCheckpoint(draft, new Map([
    ["blob:current", "asset:current"],
    ["blob:deleted", "asset:deleted"],
  ]), 123);
  validateCheckpoint(record);
  const restored = restoreCheckpoint(record, new Map([
    ["asset:current", "blob:new-current"],
    ["asset:deleted", "blob:new-deleted"],
  ]));
  assert.equal(restored.project.scenes[0].clips[0].url, "blob:new-current");
  assert.equal(restored.past[0].scenes[0].clips[0].url, "blob:new-deleted");
  assert.deepEqual(restored.past[0].allowedDomains, ["example.com"]);
  assert.equal(restored.savedAt, 123);
});

test("incomplete media never passes restore validation", () => {
  const state = initial();
  state.scenes = [scene([clip(1, "blob:missing")])];
  state.clips = state.scenes[0].clips;
  const record = { ...captureCheckpoint(state), savedAt: 123, assetIds: [] };
  assert.throws(() => validateCheckpoint(record), /video is missing/);
});

test("checkpoint validation rejects superseded or invalid response-policy shapes", () => {
  const state = initial();
  state.scenes = [scene([], [choice()])];
  state.components = state.scenes[0].components;
  const record = storeCheckpoint(captureCheckpoint(state), new Map(), 123);
  validateCheckpoint(record);

  const missing = structuredClone(record);
  delete missing.project.scenes[0].components[0].responsePolicy;
  assert.throws(() => validateCheckpoint(missing), /response policy is not supported/);

  const superseded = structuredClone(record);
  superseded.project.scenes[0].components[0].branchAtEnd = true;
  assert.throws(() => validateCheckpoint(superseded), /branchAtEnd is not supported/);

  const invalid = structuredClone(record);
  invalid.project.scenes[0].components[0].responsePolicy.dispatch = "answer";
  assert.throws(() => validateCheckpoint(invalid), /Response dispatch must be interaction or layer_end/);
});

test("checkpoint capture and storage refuse component data that cannot be restored", () => {
  const state = initial();
  const stale = choice();
  delete stale.responsePolicy;
  state.scenes = [scene([], [stale])];
  state.components = state.scenes[0].components;
  assert.throws(() => captureCheckpoint(state), /Interactive components require a response policy/);

  const valid = initial();
  valid.scenes = [scene([], [choice()])];
  valid.components = valid.scenes[0].components;
  const draft = captureCheckpoint(valid);
  delete draft.project.scenes[0].components[0].responsePolicy;
  assert.throws(() => storeCheckpoint(draft, new Map(), 123), /Interactive components require a response policy/);
});

test("named local projects survive a checkpoint while old checkpoints remain readable", () => {
  const state = { ...initial(), localId: "local-project-123", projectName: "A new story" };
  const record = storeCheckpoint(captureCheckpoint(state), new Map(), 123);
  validateCheckpoint(record);
  assert.equal(restoreCheckpoint(record, new Map()).localId, state.localId);
  assert.equal(restoreCheckpoint(record, new Map()).projectName, state.projectName);
  delete record.localId;
  delete record.projectName;
  validateCheckpoint(record);
  assert.equal(restoreCheckpoint(record, new Map()).localId, undefined);
});

function animatedState() {
  const state = initial();
  const curve = (property, first = 0, last = 1) => ({ tracks: {
    [property]: [{ time: 0, value: first, easing: "ease-in-out" }, { time: 2, value: last, easing: "hold" }],
  } });
  const current = scene([{ ...clip(1, "blob:video"), animation: curve("x", 0, 20) }],
    [{ ...choice(), animation: curve("rotation", 0, 90) }]);
  current.texts = [{ id: 2, text: "Animated title", start: 0, end: 3, x: 50, y: 50, animation: curve("opacity") }];
  current.audioClips = [{ id: 3, name: "Voice", url: "blob:audio", srcDur: 3, in: 0, out: 3,
    start: 0, speed: 1, muted: false, gain: 1, animation: curve("gain") }];
  current.sound = 1;
  current.musicAnimation = curve("gain", 1, 0);
  state.scenes = [current];
  state.past = [{ scenes: structuredClone(state.scenes), currentSceneId: "main", ratio: "9:16", allowedDomains: [] }];
  state.future = structuredClone(state.past);
  return state;
}

test("all layer animation curves survive saved projects and undo history independently", () => {
  const state = animatedState();
  const draft = captureCheckpoint(state);
  const record = storeCheckpoint(draft, new Map([["blob:video", "asset:video"], ["blob:audio", "asset:audio"]]), 123);
  validateCheckpoint(JSON.parse(JSON.stringify(record)));
  const restored = restoreCheckpoint(record, new Map([["asset:video", "blob:restored-video"], ["asset:audio", "blob:restored-audio"]]));
  const project = restored.project.scenes[0];
  const original = state.scenes[0];
  for (const key of ["clips", "texts", "components", "audioClips"]) {
    assert.deepEqual(project[key][0].animation, original[key][0].animation);
    assert.notEqual(project[key][0].animation, original[key][0].animation);
    original[key][0].animation.tracks[Object.keys(original[key][0].animation.tracks)[0]][0].value = .25;
    assert.deepEqual(restored.past[0].scenes[0][key][0].animation, project[key][0].animation);
    assert.deepEqual(restored.future[0].scenes[0][key][0].animation, project[key][0].animation);
  }
  assert.deepEqual(project.musicAnimation, original.musicAnimation);
  assert.notEqual(project.musicAnimation, original.musicAnimation);
});

test("invalid animation in a saved project or its history is rejected before rendering", () => {
  const record = storeCheckpoint(captureCheckpoint(animatedState()),
    new Map([["blob:video", "asset:video"], ["blob:audio", "asset:audio"]]), 123);
  for (const location of ["project", "past", "future"]) {
    const invalid = structuredClone(record);
    const project = location === "project" ? invalid.project : invalid[location][0];
    project.scenes[0].audioClips[0].animation = { tracks: { rotation: [{ time: 0, value: 10, easing: "linear" }] } };
    assert.throws(() => validateCheckpoint(invalid), /Scene main, audio 3: Animation property rotation is not supported/);
  }
  const unordered = structuredClone(record);
  unordered.project.scenes[0].clips[0].animation.tracks.x[1].time = 0;
  assert.throws(() => validateCheckpoint(unordered), /ordered and unique/);
  const badValue = structuredClone(record);
  badValue.project.scenes[0].musicAnimation.tracks.gain[0].value = 2;
  assert.throws(() => validateCheckpoint(badValue), /Scene main, music: Invalid gain keyframe/);
});

test("capture and storage reject curves that cannot be restored", () => {
  const invalid = animatedState();
  invalid.scenes[0].texts[0].animation.tracks.opacity[0].easing = "bounce";
  assert.throws(() => captureCheckpoint(invalid), /Invalid opacity keyframe/);
  const draft = captureCheckpoint(animatedState());
  draft.project.scenes[0].components[0].animation.tracks.rotation[0].value = NaN;
  assert.throws(() => storeCheckpoint(draft, new Map(), 123), /Invalid rotation keyframe/);
});
