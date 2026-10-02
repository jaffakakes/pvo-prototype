import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { trackingInput, trackingOutput } from "./native-tracking.helpers.mjs";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/assistant/trackingInspection.ts';
  export * from './editor/src/infrastructure/assistant/media/objectTracking.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const clip = changes => ({ id: 1, url: "blob:http://localhost/source", srcDur: 12, in: 2, out: 10,
  speed: 2, color: "#000", zoom: 1, mirror: false, width: 640, height: 360, fit: "contain", ...changes });
const project = changes => ({ ratio: "16:9", scenes: [{ id: "main", name: "Main", parent: null,
  clips: [clip()], texts: [], components: [], muted: false, sound: 0, ...changes }] });
const request = changes => ({ kind: "object_tracking", sceneId: "main", clipId: 1, start: 0, end: .2,
  target: { kind: "point", x: .4, y: .6 }, ...changes });
const capture = async () => { const { width, height, frames } = trackingInput(); return { width, height, frames }; };

test("tracking inspection maps sequential scene samples through trim and speed without crossing cuts", () => {
  const input = api.trackingInspection(project(), request());
  assert.deepEqual(input.samples.map(sample => sample.sourceTime), [2, 2 + 2 / 15, 2 + 4 / 15, 2.4]);
  for (const [value, ask] of [
    [project(), request({ end: 4.01 })], [project(), request({ clipId: 9 })],
    [project({ clips: [clip({ url: null })] }), request()],
    [project(), request({ target: { kind: "point", x: -1, y: .5 } })],
    [project({ clips: [clip({ id: 2, in: 0, out: 2, speed: 1 }), clip()] }), request({ start: 1.9, end: 2.1 })],
  ]) assert.throws(() => api.trackingInspection(value, ask));
});

test("browser sends same-origin canvas frames and generates its own observation identity", async () => {
  const output = await api.trackAssistantObject(project(), request(), { capture, fetch: async (url, options) => {
    assert.equal(url, "/api/assistant/track");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), trackingInput());
    return Response.json(trackingOutput());
  } });
  assert.equal(output.kind, "object_tracking");
  assert.match(output.id, /^[a-f0-9-]{36}$/);
  assert.equal(output.frameCount, 4);
  assert.deepEqual(output.samples, trackingOutput().frames);
});

test("browser rejects altered results and propagates only known target-selection feedback", async () => {
  await assert.rejects(api.trackAssistantObject(project(), request(), { capture,
    fetch: async () => Response.json({ ...trackingOutput(), frames: [] }),
  }), /invalid measurements/);
  await assert.rejects(api.trackAssistantObject(project(), request(), { capture,
    fetch: async () => Response.json({ error: "More than one object matches. Point to the object to track." }, { status: 422 }),
  }), error => error instanceof api.TrackingSelectionError);
  await assert.rejects(api.trackAssistantObject(project(), request(), { capture,
    fetch: async () => Response.json({ error: "private server path" }, { status: 422 }),
  }), error => !error.message.includes("private"));
});

test("browser cancellation and deadline settle even when capture or fetch ignores abort", async () => {
  let ownedSignal;
  await assert.rejects(api.trackAssistantObject(project(), request(), { deadlineMs: 10,
    capture: (_project, _request, signal) => { ownedSignal = signal; return new Promise(() => {}); },
  }), /timed out/);
  assert(ownedSignal.aborted);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(api.trackAssistantObject(project(), request(), { capture, signal: controller.signal,
    fetch: (_url, options) => { calls++; ownedSignal = options.signal; controller.abort(new Error("User cancelled")); return new Promise(() => {}); },
  }), /User cancelled/);
  assert(ownedSignal.aborted);
  assert.equal(calls, 1);
  const already = new AbortController(); already.abort(new Error("Already cancelled"));
  await assert.rejects(api.trackAssistantObject(project(), request(), { capture: () => { throw new Error("Must not capture"); }, signal: already.signal }), /Already cancelled/);
});

test("a response arriving after browser cancellation releases its body", async () => {
  let resolveResponse;
  let ready;
  const requested = new Promise(resolve => { ready = resolve; });
  const controller = new AbortController();
  const work = api.trackAssistantObject(project(), request(), { capture, signal: controller.signal,
    fetch: () => new Promise(resolve => { resolveResponse = resolve; ready(); }),
  });
  await requested;
  controller.abort(new Error("User cancelled"));
  await assert.rejects(work, /User cancelled/);
  let released = false;
  resolveResponse(new Response(new ReadableStream({ cancel() { released = true; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert(released);
});
