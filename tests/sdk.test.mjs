import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PVO_UUID,
  createPvoRuntime,
  evaluateWhen,
  inspectMp4,
  packPvo,
  readPvo,
  resolveTemplates,
  tryReadPvo,
  validatePvo,
} from "../packages/pvo-sdk/index.js";

function mp4Box(type, payload = new Uint8Array()) {
  const box = new Uint8Array(8 + payload.length);
  const view = new DataView(box.buffer);
  view.setUint32(0, box.length, false);
  box.set(new TextEncoder().encode(type), 4);
  box.set(payload, 8);
  return box;
}

function makeTinyMp4({ zeroSizedMdat = false } = {}) {
  const ftyp = mp4Box("ftyp", Uint8Array.from([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1, 0x69, 0x73, 0x6f, 0x6d]));
  const moov = mp4Box("moov", Uint8Array.from([1, 2, 3, 4]));
  const mdat = mp4Box("mdat", Uint8Array.from([10, 20, 30, 40, 50]));
  if (zeroSizedMdat) new DataView(mdat.buffer).setUint32(0, 0, false);
  return new Blob([ftyp, moov, mdat], { type: "video/mp4" });
}

function makeTinyMov() {
  const ftyp = mp4Box("ftyp", Uint8Array.from([0x71, 0x74, 0x20, 0x20, 0, 0, 0, 1, 0x71, 0x74, 0x20, 0x20]));
  const moov = mp4Box("moov", Uint8Array.from([1, 2, 3, 4]));
  const mdat = mp4Box("mdat", Uint8Array.from([10, 20, 30, 40, 50]));
  return new Blob([ftyp, moov, mdat], { type: "video/quicktime" });
}

function manifest() {
  return {
    spec_version: "0.1-prototype",
    id: "sdk_test",
    title: "SDK test",
    initial_scene: "intro",
    allowed_domains: ["creator.example"],
    state: { initial: { score: 1, path: "left" } },
    scenes: [
      { id: "intro", start: 0, end: 5, next: "ending" },
      { id: "ending", start: 5, end: 10 },
    ],
    components: [
      { id: "tip", kind: "tooltip", text: "Score: {state.score}" },
      { id: "choice", kind: "choice", options: [
        { label: "End", actions: [{ type: "goto_scene", scene: "ending" }] },
        { label: "Stay", actions: [{ type: "seek", time: 0 }] },
      ] },
      { id: "form", kind: "form", fields: [], on_submit: [{ type: "request", url: "https://creator.example/submit" }] },
    ],
    hotspots: [
      { id: "target", scene: "intro", start: 0, end: 5, x: 0.1, y: 0.2, width: 0.3, height: 0.25, actions: [{ type: "show", component: "tip" }] },
    ],
    triggers: [],
  };
}

test("validatePvo accepts a coherent manifest", () => {
  const result = validatePvo(manifest());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validatePvo reports broken references and coordinates", () => {
  const broken = manifest();
  broken.initial_scene = "missing";
  broken.hotspots[0].x = 0.9;
  broken.hotspots[0].width = 0.5;
  broken.hotspots[0].actions = [{ type: "show", component: "missing" }];
  const result = validatePvo(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("initial_scene")));
  assert.ok(result.errors.some((error) => error.includes("right edge")));
  assert.ok(result.errors.some((error) => error.includes("missing component")));
});

test("packPvo and readPvo round-trip while preserving a normal MP4 fallback", async () => {
  const source = makeTinyMp4();
  const packed = await packPvo(source, manifest());
  assert.equal(packed.type, "video/mp4");

  const packedBytes = new Uint8Array(await packed.arrayBuffer());
  const boxes = inspectMp4(packedBytes);
  assert.deepEqual(boxes.map((box) => box.type), ["ftyp", "moov", "mdat", "uuid"]);

  const decoded = await readPvo(packed);
  assert.equal(decoded.manifest.title, "SDK test");
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.videoBlob.size, source.size);
  assert.equal(PVO_UUID, "5a125a6e-8c7a-4ba8-9dd9-5e449a275056");
});

test("packPvo preserves a MOV source and QuickTime fallback", async () => {
  const source = makeTinyMov();
  const packed = await packPvo(source, manifest());
  assert.equal(packed.type, "video/quicktime");

  const decoded = await readPvo(packed);
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.videoBlob.type, "video/quicktime");
  assert.equal(decoded.videoBlob.size, source.size);
  assert.deepEqual(inspectMp4(new Uint8Array(await packed.arrayBuffer())).map((box) => box.type), ["ftyp", "moov", "mdat", "uuid"]);
});

test("repacking replaces the old PVO box instead of stacking manifests", async () => {
  const first = await packPvo(makeTinyMp4(), manifest());
  const changed = manifest();
  changed.title = "Replacement";
  const second = await packPvo(first, changed);
  const boxes = inspectMp4(new Uint8Array(await second.arrayBuffer()));
  assert.equal(boxes.filter((box) => box.type === "uuid").length, 1);
  assert.equal((await readPvo(second)).manifest.title, "Replacement");
});

test("packPvo repairs a final size-zero box before appending", async () => {
  const packed = await packPvo(makeTinyMp4({ zeroSizedMdat: true }), manifest());
  const boxes = inspectMp4(new Uint8Array(await packed.arrayBuffer()));
  assert.deepEqual(boxes.map((box) => box.type), ["ftyp", "moov", "mdat", "uuid"]);
  assert.equal(boxes[2].extendsToEnd, false);
});

test("tryReadPvo distinguishes a plain MP4", async () => {
  assert.equal(await tryReadPvo(makeTinyMp4()), null);
  await assert.rejects(() => readPvo(makeTinyMp4()), /No PVO manifest/);
});

test("conditions and templates read state and response paths", () => {
  const context = { state: { score: 4, user: { name: "Ada" } }, response: { ok: true, id: 9 } };
  assert.equal(evaluateWhen({ key: "score", gt: 3 }, context), true);
  assert.equal(evaluateWhen({ response: "/ok", is: true }, context), true);
  assert.equal(evaluateWhen({ all: [{ key: "score", gte: 4 }, { response: "/id", exists: true }] }, context), true);
  assert.deepEqual(resolveTemplates({ title: "Hi {state.user.name}", id: "{response.id}" }, context), { title: "Hi Ada", id: 9 });
});

test("runtime executes guarded state, navigation, visibility, and request outcomes", async () => {
  const events = [];
  const runtime = createPvoRuntime(manifest(), {
    show(component) { events.push(["show", component.id]); },
    hide(component) { events.push(["hide", component.id]); },
    gotoScene(scene) { events.push(["goto", scene]); },
    request(request) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "https://creator.example/submit");
      return { ok: true, confirmation: "pvo_123" };
    },
  });

  await runtime.execute([
    { type: "set", key: "score", add: 2 },
    { type: "show", component: "tip", when: { key: "score", gt: 2 } },
    { type: "goto_scene", scene: "ending", when: { key: "path", is: "left" } },
    {
      type: "request",
      method: "POST",
      url: "https://creator.example/submit",
      body: { score: "{state.score}" },
      into: "server",
      on_success: [{ type: "hide", component: "tip", when: { response: "/ok", is: true } }],
    },
  ]);

  assert.equal(runtime.state.score, 3);
  assert.equal(runtime.state.server.confirmation, "pvo_123");
  assert.deepEqual(events, [["show", "tip"], ["goto", "ending"], ["hide", "tip"]]);
});

test("true and false scene routes wait for a recorded answer", async () => {
  const delayed = manifest();
  delayed.scenes.push({ id: "decline", start: 10, end: 15 });
  delayed.components[1].presentation = { scene: "intro", start: 1, end: 4, x: 0.2, y: 0.2, width: 0.5, height: 0.3 };
  delayed.components[1].scene_change = {
    enabled: true,
    executeAt: "end",
    routes: [
      { condition: "true", sceneId: "ending" },
      { condition: "false", sceneId: "decline" },
    ],
  };
  const branch = {
    type: "branch",
    cases: [
      { when: { key: "answers.choice", is: true }, then: [{ type: "goto_scene", scene: "ending" }] },
      { when: { key: "answers.choice", is: false }, then: [{ type: "goto_scene", scene: "decline" }] },
    ],
  };
  delayed.triggers.push({ id: "choice_branch", scene: "intro", at: 4, actions: [branch] });
  assert.equal(validatePvo(delayed).valid, true);

  const destinations = [];
  const runtime = createPvoRuntime(delayed, {
    gotoScene(scene) { destinations.push(scene); },
    custom(name) {
      assert.equal(name, "submit_form");
      return false;
    },
  });
  await runtime.execute(branch);
  assert.deepEqual(destinations, []);
  await runtime.execute([{ type: "custom", name: "submit_form", into: "answers.choice" }, branch]);
  assert.equal(runtime.state.answers.choice, false);
  assert.deepEqual(destinations, ["decline"]);
});

test("scene changes require distinct True and False destination scenes", () => {
  const broken = manifest();
  broken.components[1].presentation = { scene: "intro", start: 1, end: 4, x: 0.2, y: 0.2, width: 0.5, height: 0.3 };
  broken.components[1].scene_change = {
    enabled: true,
    executeAt: "end",
    routes: [
      { condition: "true", sceneId: "ending" },
      { condition: "false", sceneId: "ending" },
    ],
  };
  const result = validatePvo(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("two different scenes")));
});

test("runtime blocks requests outside allowed_domains", async () => {
  const runtime = createPvoRuntime(manifest());
  await assert.rejects(
    () => runtime.execute({ type: "request", url: "https://wrong.example/submit" }),
    /not in allowed_domains/,
  );
});

test("published schema parses and the packed sample is readable", async () => {
  const schema = JSON.parse(await readFile(new URL("../packages/pvo-sdk/pvo-manifest.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  const sample = await readFile(new URL("../examples/signal-path.pvo.mp4", import.meta.url));
  const decoded = await readPvo(sample);
  assert.equal(decoded.validation.valid, true);
  assert.equal(decoded.manifest.scenes.length, 4);
  assert.ok(decoded.videoBlob.size < sample.length);
});
