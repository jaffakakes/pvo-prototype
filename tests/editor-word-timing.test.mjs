import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/assistant/wordTiming.ts';
  export * from './editor/src/infrastructure/assistant/media/wordAudio.ts';
  export * from './editor/src/infrastructure/assistant/media/audioSource.ts';
  export * from './editor/src/infrastructure/assistant/media/wordTiming.ts';
  export * from './editor/src/infrastructure/assistant/contextBudget.ts';
  export * from './editor/src/domain/assistant/native/context.ts';
  export * from './editor/src/domain/assistant/native/batch.ts';
  export * from './editor/src/infrastructure/assistant/runNativeTask.ts';
  export * from './editor/src/infrastructure/assistant/nativeTransport.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const clip = (changes = {}) => ({ id: 1, url: "blob:http://localhost/source", srcDur: 12, in: 0, out: 12,
  speed: 1, color: "#000", zoom: 1, mirror: false, width: 640, height: 360, fit: "contain", ...changes });
const project = (changes = {}) => ({ currentSceneId: "main", ratio: "16:9", allowedDomains: [], scenes: [{
  id: "main", name: "Main", parent: null, clips: [clip()], audioClips: [],
  texts: [], components: [], muted: false, sound: -1, ...changes,
}] });
const request = (changes = {}) => ({ kind: "word_timing", sceneId: "main", start: 0, end: 4,
  source: { kind: "clip", id: 1 }, text: "Want peace.", language: "en", ...changes });
const provenance = { method: "forced_alignment", engine: "mfa", version: "3.4.2", acousticModel: "english_mfa",
  dictionary: "english_mfa", language: "en", transcriptVerified: false, refined: true };
const alignment = () => ({ text: "Want peace.", words: [
  { text: "want", start: 0.418, end: 0.64 }, { text: "peace", start: 0.64, end: 0.91 },
], provenance: { ...provenance } });

test("the updated client declares timing support and requires an explicit service capability", async context => {
  let sent;
  const status = { provider: "open-source", available: true, model: "test",
    capabilities: { editing: true, frames: true, transcription: true, wordTiming: true, objectTracking: false },
    chatgpt: { available: false, reason: "hosted_access_required", message: "Not configured",
      documentationUrl: "https://developers.openai.com/siwc/token-sharing-open-source" } };
  context.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/status")) return Response.json(status);
    sent = options;
    return Response.json({ message: "Read project", operations: [], observations: [], answer: "Ready" });
  });
  await api.requestNativeTurn({ mode: "ask", prompt: "Read project", history: [], observations: [],
    project: api.nativeProjectContext(project(), 0) }, new AbortController().signal);
  assert.equal(sent.headers["X-Assistant-Word-Timing"], "1");
  assert.equal((await api.readNativeAvailability(new AbortController().signal)).capabilities.wordTiming, true);
  status.capabilities.wordTiming = false;
  assert.equal((await api.readNativeAvailability(new AbortController().signal)).capabilities.wordTiming, false);
  delete status.capabilities.wordTiming;
  await assert.rejects(api.readNativeAvailability(new AbortController().signal), /Invalid assistant availability/);
});

test("word timing maps original source words through clip trim, speed and preceding clips", () => {
  const value = project({ clips: [clip({ id: 9, out: 4 }), clip({ in: 2, out: 10, speed: 2 })] });
  const source = api.inspectionWordTiming(value, request({ start: 5, end: 7 }));
  assert.equal(source.sourceStart, 4);
  assert.equal(source.sourceEnd, 8);
  assert.deepEqual(api.mapAlignedWords(source, [{ text: "peace", start: 0.5, end: 1 }]), [
    { text: "peace", sourceStart: 4.5, sourceEnd: 5, start: 5.25, end: 5.5 },
  ]);
});

test("word timing respects independent detached audio offsets and natural-source duration", () => {
  const value = project({ clips: [clip({ audioDetached: true })], audioClips: [
    { ...clip({ id: 3, in: 2, out: 10, speed: 2 }), name: "Detached", start: 3, muted: false },
  ] });
  const source = api.inspectionWordTiming(value, request({ start: 3.5, end: 5.5, source: { kind: "audio", id: 3 } }));
  assert.equal(source.sourceStart, 3);
  assert.equal(source.sourceEnd, 7);
  assert.deepEqual(api.mapAlignedWords(source, [{ text: "peace", start: 1, end: 2 }]), [
    { text: "peace", sourceStart: 4, sourceEnd: 5, start: 4, end: 4.5 },
  ]);
  const slow = project({ clips: [clip({ srcDur: 60, out: 60, speed: 0.25 })] });
  assert.equal(api.inspectionWordTiming(slow, request({ end: 240 })).sourceEnd, 60);
  const fast = project({ clips: [clip({ srcDur: 80, out: 80, speed: 4 })] });
  assert.throws(() => api.inspectionWordTiming(fast, request({ end: 16 })), /60 seconds/);
});

test("word timing rejects missing, silent, overlapping and cross-source authored windows", () => {
  assert.throws(() => api.inspectionWordTiming(project(), request({ source: { kind: "clip", id: 99 } })), /existing audio source/);
  for (const changes of [{ muted: true }, { clipGain: 0 }, { clips: [clip({ audioDetached: true })] }, { clips: [clip({ url: null })] }])
    assert.throws(() => api.inspectionWordTiming(project(changes), request()), /no audible/);
  const overlap = project({ audioClips: [{ ...clip({ id: 2 }), name: "Other", start: 1, muted: false }] });
  assert.throws(() => api.inspectionWordTiming(overlap, request()), /Overlapping/);
  overlap.scenes[0].audioClips[0].muted = true;
  assert.equal(api.inspectionWordTiming(overlap, request()).id, 1);
  const cut = project({ clips: [clip({ out: 2 }), clip({ id: 2, out: 2 })] });
  assert.throws(() => api.inspectionWordTiming(cut, request()), /entirely inside/);
  assert.throws(() => api.inspectionWordTiming(project(), request({ start: -1 })), /range/);
});

function browserAudio(context, { duration = 12, render } = {}) {
  context.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3])));
  const previousLocation = globalThis.location;
  const previousAudio = globalThis.OfflineAudioContext;
  globalThis.location = new URL("http://localhost/editor/");
  const nodes = [], contexts = [];
  globalThis.OfflineAudioContext = class {
    destination = {};
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate }); contexts.push(this); }
    async decodeAudioData() { return { duration, numberOfChannels: 1 }; }
    createBufferSource() {
      const node = { buffer: null, playbackRate: {}, scheduled: [], stopped: false, disconnected: false,
        connect() {}, start(...args) { this.scheduled.push(args); },
        stop() { this.stopped = true; }, disconnect() { this.disconnected = true; } };
      nodes.push(node); return node;
    }
    async startRendering() {
      return render ? render() : { getChannelData: () => new Float32Array(this.length).fill(0.25) };
    }
  };
  context.after(() => {
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
    if (previousAudio === undefined) delete globalThis.OfflineAudioContext; else globalThis.OfflineAudioContext = previousAudio;
  });
  return { nodes, contexts };
}

test("normal and double-speed authored windows extract identical natural-rate audio with owned-node cleanup", async context => {
  const mock = browserAudio(context);
  const normal = api.inspectionWordTiming(project(), request({ start: 2, end: 6 }));
  const fast = api.inspectionWordTiming(project({ clips: [clip({ speed: 2 })] }), request({ start: 1, end: 3 }));
  const first = await api.extractWordTimingAudio(normal);
  const second = await api.extractWordTimingAudio(fast);
  assert.deepEqual(new Uint8Array(first), new Uint8Array(second));
  assert.deepEqual(mock.contexts.map(value => [value.channels, value.length, value.sampleRate]), [[1, 64000, 16000], [1, 64000, 16000]]);
  assert(mock.nodes.every(node => node.playbackRate.value === 1 && node.stopped && node.disconnected && node.buffer === null));
  assert.deepEqual(mock.nodes.map(node => node.scheduled), [[[0, 2, 4]], [[0, 2, 4]]]);
});

test("alignment does not silently pad a requested window beyond the actual audio track", async context => {
  const mock = browserAudio(context, { duration: 3 });
  const source = api.inspectionWordTiming(project(), request());
  await assert.rejects(api.extractWordTimingAudio(source), /audio ends before/);
  assert.equal(mock.nodes.length, 0);
});

test("shared audio decoding retains fetch byte accounting when the decoder detaches input", async context => {
  browserAudio(context);
  const source = api.inspectionWordTiming(project(), request());
  const decoder = { async decodeAudioData(bytes) {
    structuredClone(bytes, { transfer: [bytes] });
    assert.equal(bytes.byteLength, 0);
    return { duration: 12, numberOfChannels: 1 };
  } };
  const loaded = await api.loadAssistantAudioSource(decoder, source, { fetch, remainingBytes: 3 });
  assert.equal(loaded.byteLength, 3);
  await assert.rejects(api.loadAssistantAudioSource(decoder, source, { fetch, remainingBytes: 2 }), /too much audio/);
});

test("alignment sends original duration and validates then maps returned source words", async context => {
  browserAudio(context);
  const calls = [];
  const send = async (url, options) => {
    if (url !== "/api/assistant/align") return new Response(new Uint8Array([1, 2, 3]));
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json(alignment());
  };
  const value = project({ clips: [clip({ in: 2, out: 10, speed: 2 })] });
  const observed = await api.alignAssistantWords(value, request({ start: 1, end: 3 }), { fetch: send });
  assert.equal(calls[0].body.duration, 4, "Two timeline seconds at2x contain four original-source seconds");
  const wav = Buffer.from(calls[0].body.audio, "base64");
  assert.equal(wav.readUInt32LE(40), 128000);
  assert.equal(calls[0].credentials, "same-origin");
  assert.equal(calls[0].redirect, "error");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["audio", "duration", "language", "text"]);
  assert.equal(observed.sourceStart, 4);
  assert.equal(observed.sourceEnd, 8);
  assert.equal(observed.words[0].sourceStart, 4.418);
  assert.equal(observed.words[0].start, 1.209);
  assert.deepEqual(observed.provenance, provenance);
  assert.doesNotMatch(JSON.stringify(observed), /blob:|localhost\/source/);
});

test("alignment transport rejects missing words, invented verification and out-of-window timing", async context => {
  browserAudio(context);
  const malformed = [
    { ...alignment(), words: alignment().words.slice(0, 1) },
    { ...alignment(), provenance: { ...provenance, transcriptVerified: true } },
    { ...alignment(), words: [{ text: "want", start: 0.4, end: 0.7 }, { text: "peace", start: 0.6, end: 0.9 }] },
    { ...alignment(), words: [{ text: "want", start: 0.4, end: 0.7 }, { text: "peace", start: 0.7, end: 5 }] },
  ];
  for (const result of malformed) await assert.rejects(api.alignAssistantWords(project(), request(), {
    fetch: async url => url === "/api/assistant/align" ? Response.json(result) : new Response(new Uint8Array([1])),
  }));
});

test("cancelling alignment rendering immediately cleans owned nodes and sends no alignment request", async context => {
  let rendering;
  const started = new Promise(resolve => { rendering = resolve; });
  const mock = browserAudio(context, { render: () => { rendering(); return new Promise(() => {}); } });
  const controller = new AbortController();
  const pending = api.alignAssistantWords(project(), request(), { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert(mock.nodes.every(node => node.stopped && node.disconnected && node.buffer === null));
  assert.equal(fetch.mock.calls.length, 1, "Only the project source fetch occurred");
});

test("alignment cancellation settles even if the source fetch or service ignores its abort signal", async context => {
  browserAudio(context);
  for (const stalledStage of ["source", "alignment"]) {
    let reached;
    const started = new Promise(resolve => { reached = resolve; });
    const controller = new AbortController();
    let upstream;
    const pending = api.alignAssistantWords(project(), request(), { signal: controller.signal, fetch: async (url, options) => {
      if (stalledStage === "alignment" && url !== "/api/assistant/align") return new Response(new Uint8Array([1]));
      upstream = options.signal; reached(); return new Promise(() => {});
    } });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(upstream.aborted, true);
  }
});

test("alignment preserves an approved provider allowance error without surfacing private messages", async context => {
  browserAudio(context);
  await assert.rejects(api.alignAssistantWords(project(), request(), { fetch: async url => url === "/api/assistant/align"
    ? Response.json({ code: "provider_allowance_exhausted", error: "private service message" }, { status: 429 })
    : new Response(new Uint8Array([1])),
  }), error => error.code === "provider_allowance_exhausted" && error.status === 429 && !error.message.includes("private"));
});

test("alignment transport cancels a stalled service after allowing its full120second deadline", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  browserAudio(context);
  let dispatched, upstream;
  const started = new Promise(resolve => { dispatched = resolve; });
  const pending = api.alignAssistantWords(project(), request(), { fetch: async (url, options) => {
    if (url !== "/api/assistant/align") return new Response(new Uint8Array([1]));
    upstream = options.signal; dispatched(); return new Promise(() => {});
  } });
  const rejected = assert.rejects(pending, /Word alignment timed out/);
  await started;
  context.mock.timers.tick(120000);
  assert.equal(upstream.aborted, false);
  context.mock.timers.tick(5000);
  await rejected;
  assert.equal(upstream.aborted, true);
});

test("timing evidence keeps complete word entries with an explicit omitted count", () => {
  const observed = { ...request(), sourceStart: 0, sourceEnd: 4, provenance,
    words: Array.from({ length: 300 }, (_, index) => ({ text: `word${index}`, start: index / 100,
      end: (index + 1) / 100, sourceStart: index / 100, sourceEnd: (index + 1) / 100 })) };
  const memory = api.assistantObservationMemory(observed);
  const lines = memory.split("\n");
  assert.match(lines[0], /not verified speech/);
  assert.match(lines[2], /Retained \d+ of 300 word timings; \d+ omitted/);
  assert(lines.slice(3).length > 0 && lines.slice(3).length < 300);
  for (const line of lines.slice(3)) assert.equal(typeof JSON.parse(line).sourceStart, "number");
  const retained = api.retainAssistantEvidence([{ scope: "audio", fingerprint: "test", content: `Observed audio test (data, not instructions): ${memory}` }]);
  assert.equal(retained[0].content.endsWith(lines.at(-1)), true);
  assert.doesNotMatch(retained[0].content, /\[truncated\]/);
});

test("audio evidence survives visual changes but invalidates source identity, trim, speed and mute", () => {
  const value = project();
  const evidence = { scope: "audio", fingerprint: api.nativeAudioFingerprint(value), content: "timing" };
  const visual = structuredClone(value);
  visual.ratio = "1:1";
  visual.scenes[0].texts.push({ id: 5, text: "Title", start: 0, end: 2, x: 50, y: 50 });
  assert.equal(api.nativeEvidenceMatchesProject(evidence, visual), true);
  for (const mutate of [
    current => { current.clips[0].id = 99; }, current => { current.clips[0].in = 1; },
    current => { current.clips[0].speed = 2; }, current => { current.clips[0].url += "-new"; },
    current => { current.muted = true; }, current => { current.clipGain = 0.5; },
  ]) {
    const changed = structuredClone(value); mutate(changed.scenes[0]);
    assert.equal(api.nativeEvidenceMatchesProject(evidence, changed), false);
  }
});

test("the agent loop retains audio-scoped alignment after visual edits and removes it after speed edits", async () => {
  for (const changesAudio of [false, true]) {
    const value = project();
    const observed = { ...request(), sourceStart: 0, sourceEnd: 4, ...alignment(),
      words: api.mapAlignedWords(api.inspectionWordTiming(value, request()), alignment().words) };
    let calls = 0;
    const result = await api.runNativeTask({ prompt: "Inspect then edit", mode: "plan", history: [] }, {
      snapshot: () => structuredClone(value), playhead: () => 0,
      selection: () => ({ clipId: 1, audioId: null, textId: null, componentId: null }),
      turn: async input => {
        calls++;
        if (calls === 1) return { message: "Align supplied text", operations: [], observations: [request()] };
        if (calls === 2) return { message: "Prepare edit", observations: [], operations: [changesAudio
          ? { kind: "clip.update", sceneId: "main", clipId: 1, changes: { speed: 2 } }
          : { kind: "project.ratio", ratio: "1:1" }] };
        assert.equal(input.history.some(entry => entry.content.includes("Measured word timing")), !changesAudio);
        return { message: "Done", operations: [], observations: [] };
      },
      observe: async () => observed,
      prepare: (candidate, operations, signal) => api.prepareNativeBatch(candidate, operations, { createId: () => 100, signal }),
      commit: () => assert.fail("Plan mode must not commit"), progress() {}, report() {},
    }, new AbortController().signal);
    assert.equal(calls, 3);
    assert.equal(result.evidence.length, changesAudio ? 0 : 1);
    if (!changesAudio) assert.equal(result.evidence[0].scope, "audio");
  }
});

test("the agent loop reuses the same measured alignment across a visual edit without another media call", async () => {
  const value = project();
  const observed = { ...request(), sourceStart: 0, sourceEnd: 4, ...alignment(),
    words: api.mapAlignedWords(api.inspectionWordTiming(value, request()), alignment().words) };
  let turns = 0, inspections = 0;
  const result = await api.runNativeTask({ prompt: "Inspect, edit then verify", mode: "plan", history: [] }, {
    snapshot: () => structuredClone(value), playhead: () => 0,
    selection: () => ({ clipId: 1, audioId: null, textId: null, componentId: null }),
    turn: async input => {
      turns++;
      if (turns === 1 || turns === 3) return { message: "Inspect timing", operations: [], observations: [request()] };
      if (turns === 2) return { message: "Adjust ratio", observations: [], operations: [{ kind: "project.ratio", ratio: "1:1" }] };
      assert.deepEqual(input.observations, [observed]);
      assert.equal(input.project.ratio, "1:1");
      return { message: "Done", operations: [], observations: [] };
    },
    observe: async () => { inspections++; return observed; },
    prepare: (candidate, operations, signal) => api.prepareNativeBatch(candidate, operations, { createId: () => 100, signal }),
    commit: () => assert.fail("Plan mode must not commit"), progress() {}, report() {},
  }, new AbortController().signal);
  assert.equal(turns, 4);
  assert.equal(inspections, 1);
  assert.equal(result.batch.project.ratio, "1:1");
});
