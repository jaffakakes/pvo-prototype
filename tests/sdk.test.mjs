import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  PVO_CONTAINER_MIME,
  PVO_UUID,
  createPvoRuntime,
  evaluateWhen,
  inspectMp4,
  packPvo,
  packPvoProject,
  readPvo,
  readPvoProject,
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

test("validatePvo checks Card button actions without treating button wrappers as actions", () => {
  const project = manifest();
  project.components.push({
    id: "card", kind: "card", title: "Next step",
    actions: [{ label: "Continue", action: { type: "goto_scene", scene: "ending" } }],
  });
  assert.deepEqual(validatePvo(project).errors, []);

  project.components.at(-1).actions[0].action.scene = "missing";
  assert.match(validatePvo(project).errors.join("\n"), /missing scene/);
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

test("self-contained .pvo packages keep the main media and every branch asset", async () => {
  const projectManifest = {
    spec_version: "0.1-prototype",
    title: "Branch package",
    initial_scene: "main_scene",
    media: [
      { id: "main_media", asset_id: "main_media", name: "main.mp4", type: "video/mp4" },
      { id: "branch_media", asset_id: "branch_media", name: "answer.mov", type: "video/quicktime" },
    ],
    playback: {
      initial_timeline: "main",
      timelines: [
        { id: "main", kind: "main", clips: [{ id: "main_clip", asset_id: "main_media", scene: "main_scene", start: 0, end: 5 }] },
        { id: "branch:choice:true", kind: "branch", condition: "true", clips: [{ id: "branch_clip", asset_id: "branch_media", scene: "branch_scene", start: 0, end: 5 }] },
        { id: "branch:choice:false", kind: "branch", condition: "false", clips: [{ id: "branch_clip", asset_id: "branch_media", scene: "branch_scene", start: 0, end: 5 }] },
      ],
    },
    scenes: [
      { id: "main_scene", asset_id: "main_media", start: 0, end: 5 },
      { id: "branch_scene", asset_id: "branch_media", start: 0, end: 5 },
    ],
    components: [{
      id: "choice",
      kind: "choice",
      options: [
        { label: "Yes", actions: [{ type: "set", key: "answers.choice", value: true }] },
        { label: "No", actions: [{ type: "set", key: "answers.choice", value: false }] },
      ],
      presentation: { scene: "main_scene", clip: "main_clip", timeline: "main", start: 1, end: 4, x: 0.2, y: 0.2, width: 0.5, height: 0.3 },
      scene_change: {
        enabled: true,
        executeAt: "end",
        routes: [
          { condition: "true", timelineId: "branch:choice:true" },
          { condition: "false", timelineId: "branch:choice:false" },
        ],
      },
    }],
    hotspots: [],
    triggers: [],
  };
  assert.equal(validatePvo(projectManifest).valid, true);

  const main = makeTinyMp4();
  const branch = makeTinyMov();
  const packed = await packPvoProject({
    manifest: projectManifest,
    assets: [
      { id: "main_media", name: "main.mp4", file: main },
      { id: "branch_media", name: "answer.mov", file: branch },
    ],
  });
  assert.equal(packed.type, PVO_CONTAINER_MIME);

  const project = await readPvoProject(packed);
  assert.equal(project.container, true);
  assert.equal(project.assets.length, 2);
  assert.deepEqual(project.assets.map((asset) => [asset.id, asset.type, asset.size]), [
    ["main_media", "video/mp4", main.size],
    ["branch_media", "video/quicktime", branch.size],
  ]);
  const decoded = await readPvo(packed);
  assert.equal(decoded.container, true);
  assert.equal(decoded.videoBlob.size, main.size);
  assert.equal(decoded.manifest.playback.timelines.length, 3);
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

test("request actions send real HTTP, expose responses, and run ordered actions without implicit routing", async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ method: request.method, path: request.url, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ accepted: true, confirmation: "ok_123" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const host = `127.0.0.1:${server.address().port}`;
  const m = manifest();
  m.allowed_domains = [host];
  const events = [];
  const runtime = createPvoRuntime(m, { gotoScene(scene) { events.push(scene); } });
  await runtime.execute({
    type: "chain",
    actions: [
      { type: "set", key: "order", value: "first" },
      {
        type: "request", method: "POST", url: `http://${host}/submit`,
        body: { score: "{state.score}" }, into: "receipt",
        on_success: [{
          type: "branch",
          cases: [{ when: { response: "/accepted", is: true }, then: [
            { type: "set", key: "order", value: "accepted" },
            { type: "set", key: "receipt_id", value: "{response.confirmation}" },
          ] }],
          else: { type: "goto_scene", scene: "ending" },
        }],
      },
      { type: "set", key: "finished", value: true },
    ],
  });
  assert.deepEqual(received, [{ method: "POST", path: "/submit", body: '{"score":1}' }]);
  assert.equal(runtime.state.order, "accepted");
  assert.equal(runtime.state.receipt_id, "ok_123");
  assert.equal(runtime.state.receipt.confirmation, "ok_123");
  assert.equal(runtime.state.finished, true);
  assert.deepEqual(events, []);
});

test("request domains are opt-in and invalid or disallowed URLs use on_error", async () => {
  const m = manifest();
  delete m.allowed_domains; // Valid manifest, but no network permission.
  assert.equal(validatePvo(m).valid, true);
  let calls = 0;
  const events = [];
  const runtime = createPvoRuntime(m, {
    request() { calls += 1; return { ok: true }; },
    onEvent(event) { events.push(event.type); },
  });
  const denied = {
    type: "request", url: "https://creator.example/submit",
    on_success: { type: "set", key: "path", value: "success" },
    on_error: { type: "set", key: "path", value: "error" },
  };
  assert.equal(await runtime.execute(denied), undefined);
  assert.equal(runtime.state.path, "error");
  assert.equal(calls, 0);
  assert.ok(events.includes("request_error"));
  await runtime.execute({ type: "request", url: "https://creator.example/submit" });
  assert.equal(calls, 0); // No on_error means no-op, not an uncaught exception.

  m.allowed_domains = ["creator.example"];
  const allowed = createPvoRuntime(m, { request() { calls += 1; return { ok: true }; } });
  for (const url of ["https://evil.example/", "https://creator.example.evil.example/", "ftp://creator.example/", "https://user:secret@creator.example/", "/relative"]) {
    await allowed.execute({
      type: "request", url,
      on_error: { type: "set", key: "last_error", value: "{response.error}" },
    });
    assert.equal(typeof allowed.state.last_error, "string");
  }
  assert.equal(calls, 0);
  await allowed.execute({ type: "request", url: "https://{state.path}.example/" });
  assert.equal(calls, 0); // The resolved URL is checked, not just the template.
});

test("HTTP errors, offline failures, and redirects never take the success path or queue requests", async (t) => {
  let unexpectedHits = 0;
  const server = createServer((request, response) => {
    if (request.url === "/fail") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end('{"error":"unavailable"}');
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/unexpected" });
      response.end();
    } else {
      unexpectedHits += 1;
      response.end("unexpected");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const host = `127.0.0.1:${server.address().port}`;
  const m = manifest();
  m.allowed_domains = [host];
  const runtime = createPvoRuntime(m);
  const action = (url) => ({
    type: "request", url,
    on_success: { type: "set", key: "result", value: "success" },
    on_error: { type: "set", key: "result", value: "{response.error}" },
  });
  await runtime.execute(action(`http://${host}/fail`));
  assert.match(runtime.state.result, /503/);
  await runtime.execute(action(`http://${host}/redirect`));
  assert.equal(typeof runtime.state.result, "string");
  assert.notEqual(runtime.state.result, "success");
  assert.equal(unexpectedHits, 0);

  let attempts = 0;
  const offline = createPvoRuntime(m, { request() { attempts += 1; throw new TypeError("Network unavailable"); } });
  await offline.execute(action(`http://${host}/submit`));
  assert.equal(offline.state.result, "Network unavailable");
  assert.equal(attempts, 1);
  await offline.execute({ type: "request", url: `http://${host}/submit` });
  assert.equal(attempts, 2); // No automatic retry or offline queue.
  await assert.rejects(
    () => offline.execute(action(`http://${host}/submit`), { throwOnRequestError: true }),
    /Network unavailable/,
  );
  assert.equal(offline.state.result, "Network unavailable"); // on_error ran before the rejection.
  assert.equal(attempts, 3);
});

test("imperative request bridges receive parsed data or a rejected Promise", async () => {
  const m = manifest();
  const runtime = createPvoRuntime(m, { request() { return { ok: true, message: "saved" }; } });
  runtime.setState("form.comp1.text_0", "Ada");
  const data = await runtime.execute({
    type: "request", url: "https://creator.example/submit",
    body: { name: "{state.form.comp1.text_0}" },
  }, { throwOnRequestError: true });
  assert.deepEqual(data, { ok: true, message: "saved" });
  const blocked = createPvoRuntime({ ...m, allowed_domains: [] });
  await assert.rejects(
    () => blocked.execute({ type: "request", url: "https://creator.example/submit" }, { throwOnRequestError: true }),
    /not in allowed_domains/,
  );
});

test("an on_success action failure is not misreported as a network failure", async () => {
  const m = manifest();
  let errors = 0;
  const runtime = createPvoRuntime(m, { request() { return { ok: true }; }, custom() { throw new Error("Action failed"); } });
  await assert.rejects(() => runtime.execute({
    type: "request", url: "https://creator.example/submit",
    on_success: { type: "custom", name: "broken" },
    on_error: { type: "set", key: "error_count", add: 1 },
  }), /Action failed/);
  errors = runtime.state.error_count || 0;
  assert.equal(errors, 0);
});

test("state paths cannot traverse inherited properties or mutate prototypes", () => {
  const runtime = createPvoRuntime(manifest());
  assert.equal(evaluateWhen({ key: "constructor", exists: true }, { state: runtime.state }), false);
  assert.throws(() => runtime.setState("forms.__proto__.polluted", true), /reserved key/);
  assert.equal({}.polluted, undefined);
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
