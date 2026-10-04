import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { renderInput } from "../server/render-jobs/input.js";

const bundled = buildSync({ stdin: { contents: `
  export { createServerSceneRenderer } from "./editor/src/infrastructure/media/serverRender.ts";
  export { canRenderSceneOnServer } from "./editor/src/domain/export/serverRenderEligibility.ts";
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
const { createServerSceneRenderer, canRenderSceneOnServer } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function scene() {
  return {
    clips: [{ id: 1, url: "blob:leased", color: "#000", srcDur: 2, in: .25, out: 1.75,
      speed: 1.5, zoom: 1.2, mirror: true, width: 1920, height: 1080, fit: "cover" }],
    audioClips: [{ id: 2, name: "Source sound", url: "blob:leased", srcDur: 2, in: 0, out: 1,
      speed: 1, start: 0, muted: false }],
    texts: [], components: [], layers: ["video"], muted: false, sound: 0, ratio: "9:16", quality: "1080p",
  };
}

function fakeService({ available = true, jobStatus = "ready", qualities = ["720p", "1080p", "4K"] } = {}) {
  const calls = [];
  const response = (body, status = 200) => Response.json(body, { status });
  const send = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init.method;
    calls.push({ path, method, body: init.body, signal: init.signal, credentials: init.credentials, redirect: init.redirect });
    if (path === "/api/renders" && method === "GET")
      return response({ available, maxSourceBytes: 1000, maxSources: 4, formats: available ? ["video"] : [],
        qualities: available ? qualities : [] });
    if (path === "/api/renders" && method === "POST") {
      // Exercise the real Worker boundary so the HTTP projection cannot drift
      // from required source metadata while a permissive fake keeps passing.
      renderInput(JSON.parse(init.body));
      return response({ id: "job_one", status: "uploading", progress: 0 }, 201);
    }
    if (path === "/api/renders/job_one/sources/asset_0" && method === "PUT")
      return response({ uploaded: true });
    if (path === "/api/renders/job_one/start" && method === "POST")
      return response({ id: "job_one", status: "queued", progress: 0 }, 202);
    if (path === "/api/renders/job_one" && method === "GET")
      return response({ id: "job_one", status: jobStatus, progress: jobStatus === "ready" ? 1 : .5 });
    if (path === "/api/renders/job_one/result" && method === "GET")
      return new Response(new Blob(["original-source-rendered"], { type: "video/mp4" }), {
        headers: { "Content-Type": "video/mp4" },
      });
    if (path === "/api/renders/job_one" && method === "DELETE") return response({ cancelled: true });
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { send, calls };
}

test("server render uploads original bytes once, preserves quality and edits, and cleans private files", async () => {
  const service = fakeService();
  const source = scene();
  source.texts = [{ id: 3, text: "private caption", start: 0, end: 2, color: 1, x: 2, y: 3 }];
  source.components = [{ id: "private_component", at: 1, dur: 2,
    fields: { text: "private interaction" }, code: { pvo: { logic: "private destination" } } }];
  source.layers = ["text:3", "video", "component:private_component"];
  const original = new Blob(["original camera pixels"], { type: "video/quicktime" });
  const stages = [], progress = [];
  const render = createServerSceneRenderer({ origin: "https://restyle.example", fetch: service.send, pollMs: 1 });
  const result = await render(source, new Map([["blob:leased", original]]), value => progress.push(value),
    undefined, stage => stages.push(stage));
  assert.equal(await result.blob.text(), "original-source-rendered");
  assert.equal(result.blob.type, "video/mp4");
  assert.equal(result.name, "restyle-video.mp4");
  URL.revokeObjectURL(result.url);
  assert.deepEqual(stages, ["uploading", "rendering", "downloading"]);
  assert.equal(progress.at(-1), 1);
  const create = service.calls.find(call => call.path === "/api/renders" && call.method === "POST");
  const payload = JSON.parse(create.body);
  assert.equal(payload.source.quality, "1080p");
  assert.equal(payload.source.clips[0].speed, 1.5);
  assert.equal(payload.source.clips[0].fit, "cover");
  assert.equal(payload.source.clips[0].url, "asset_0");
  assert.equal(payload.source.audioClips[0].url, "asset_0", "one original used twice uploads once");
  assert.deepEqual(payload.source.texts, [{ id: 3, start: 0, end: 2 }]);
  assert.deepEqual(payload.source.components, [{ id: "private_component", at: 1, dur: 2 }]);
  assert.deepEqual(payload.source.layers, source.layers);
  assert.deepEqual(payload.assets, [{ id: "asset_0", bytes: original.size, contentType: "video/quicktime" }]);
  assert(!create.body.includes("blob:leased"), "local browser URLs never leave the editor");
  for (const privateValue of ["private caption", "private interaction", "private destination", "Source sound"])
    assert(!create.body.includes(privateValue), "render requests contain timing but not authored/private content");
  const upload = service.calls.find(call => call.method === "PUT");
  assert.equal(upload.body, original);
  assert.equal(service.calls.at(-1).method, "DELETE", "the result is copied before source/result cleanup");
  assert(service.calls.every(call => call.credentials === "same-origin" && call.redirect === "error"));
  assert.equal(source.clips[0].url, "blob:leased", "the submitted scene is not mutated");
});

test("an unavailable service leaves local rendering available without starting a job", async () => {
  const service = fakeService({ available: false });
  const render = createServerSceneRenderer({ origin: "https://restyle.example", fetch: service.send });
  assert.equal(await render(scene(), new Map([["blob:leased", new Blob(["source"])]]), () => {}), null);
  assert.deepEqual(service.calls.map(({ path, method }) => `${method} ${path}`), ["GET /api/renders"]);
});

test("4K uses the server only when its capability advertises that quality", async () => {
  const unsupported = fakeService({ qualities: ["720p", "1080p"] });
  const fourK = { ...scene(), quality: "4K" };
  const original = new Blob(["source"]);
  const renderWithoutFourK = createServerSceneRenderer({ origin: "https://restyle.example", fetch: unsupported.send });
  assert.equal(await renderWithoutFourK(fourK, new Map([["blob:leased", original]]), () => {}), null);
  assert.deepEqual(unsupported.calls.map(({ path, method }) => `${method} ${path}`), ["GET /api/renders"]);

  const supported = fakeService();
  const renderFourK = createServerSceneRenderer({ origin: "https://restyle.example", fetch: supported.send, pollMs: 1 });
  const result = await renderFourK(fourK, new Map([["blob:leased", original]]), () => {});
  assert.equal(result.blob.type, "video/mp4");
  URL.revokeObjectURL(result.url);
  const create = supported.calls.find(call => call.path === "/api/renders" && call.method === "POST");
  assert.equal(JSON.parse(create.body).source.quality, "4K");
});

test("server eligibility follows the actual text layer and soundtrack", () => {
  const source = scene();
  assert.equal(canRenderSceneOnServer(source), true);
  source.texts.push({ id: 3, text: "Caption", start: 0, end: 1, color: 0, x: 0, y: 0 });
  source.layers = ["text:3", "video"];
  assert.equal(canRenderSceneOnServer(source), true, "opaque video hides this text in the current exporter");
  source.layers = ["video", "text:3"];
  assert.equal(canRenderSceneOnServer(source), false, "visible text needs browser text-painter parity");
  source.texts = [];
  source.sound = .5;
  assert.equal(canRenderSceneOnServer(source), false);
  source.sound = -1;
  assert.equal(canRenderSceneOnServer(source), false);
});

test("cancelling a queued render deletes its private job", async () => {
  const service = fakeService({ jobStatus: "queued" });
  const controller = new AbortController();
  const render = createServerSceneRenderer({ origin: "https://restyle.example", fetch: service.send, pollMs: 1000 });
  const running = render(scene(), new Map([["blob:leased", new Blob(["source"])]]), () => {},
    controller.signal, stage => { if (stage === "rendering") setTimeout(() => controller.abort(), 10); });
  await assert.rejects(running, error => error?.name === "AbortError");
  assert.equal(service.calls.at(-1).method, "DELETE");
});

const curve = property => ({ tracks: { [property]: [{ time: 0, value: .5, easing: "linear" }] } });

test("unsupported animation and gain use browser rendering before any network request", async () => {
  const cases = [
    source => { source.clipGain = .5; },
    source => { source.musicGain = .5; },
    source => { source.musicAnimation = curve("gain"); },
    source => { source.clips[0].animation = curve("x"); },
    source => { source.clips[0].animation = curve("gain"); source.includeVideoAnimation = false; },
    source => { source.audioClips[0].gain = .5; },
    source => { source.audioClips[0].animation = curve("gain"); },
  ];
  for (const change of cases) {
    const source = scene();
    change(source);
    assert.equal(canRenderSceneOnServer(source), false);
    const service = fakeService();
    const render = createServerSceneRenderer({ origin: "https://restyle.example", fetch: service.send });
    assert.equal(await render(source, new Map(), () => {}), null);
    assert.equal(service.calls.length, 0, "ineligible scenes never upload media or create jobs");
  }
});

test("PVO plain media remains eligible while native text, fonts and visual motion stay in the package", async () => {
  const source = scene();
  source.includeText = false;
  source.includeVideoAnimation = false;
  source.clips[0].animation = curve("x");
  source.texts = [{ id: 3, text: "Private native caption", start: 0, end: 2,
    style: { fontAsset: { bytes: "private-font-bytes" } }, animation: curve("opacity") }];
  source.layers = ["video", "text:3"];
  assert.equal(canRenderSceneOnServer(source), true);
  const service = fakeService();
  const render = createServerSceneRenderer({ origin: "https://restyle.example", fetch: service.send, pollMs: 1 });
  const result = await render(source, new Map([["blob:leased", new Blob(["source"], { type: "video/mp4" })]]), () => {});
  URL.revokeObjectURL(result.url);
  const create = service.calls.find(call => call.method === "POST" && call.path === "/api/renders");
  const payload = JSON.parse(create.body);
  assert.equal(payload.source.includeText, false);
  assert.equal(payload.source.clips[0].animation, undefined);
  assert(!create.body.includes("private-font-bytes"));
  assert(!create.body.includes("Private native caption"));
});
