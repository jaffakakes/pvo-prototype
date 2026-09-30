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
