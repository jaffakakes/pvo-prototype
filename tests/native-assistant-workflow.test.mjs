import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: { contents: [
    "export { runNativeTask } from './editor/src/infrastructure/assistant/runNativeTask.ts';",
    "export { prepareNativeBatch } from './editor/src/domain/assistant/native/batch.ts';",
    "export { nativeProjectFingerprint, nativeEvidenceMatchesProject } from './editor/src/domain/assistant/native/context.ts';",
    "export { AssistantPolicyError } from './packages/pvo-assistant/policy.js';",
  ].join("\n"), resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { runNativeTask, prepareNativeBatch, nativeProjectFingerprint, nativeEvidenceMatchesProject, AssistantPolicyError } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

const answer = { message: "Done", operations: [], observations: [] };
const edit = { message: "A square video", operations: [{ kind: "project.ratio", ratio: "1:1" }], observations: [] };
const inspect = request => ({ message: "Inspecting the footage", operations: [], observations: [request] });
const frames = { kind: "frames", sceneId: "main", start: 0, end: 1, count: 1 };
const transcript = { kind: "transcript", sceneId: "main", start: 0, end: 1 };
const operations = (...items) => ({ message: "Prepared the requested change", operations: items, observations: [] });

// Compiler behavior has separate coverage; this fixture compiles the one tooltip
// grammar used here while retaining real component creation, IDs and batch rules.
const compileTooltip = async (_type, source) => ({
  structure: { type: "tooltip", text: source.structure.match(/<text>(.*?)<\/text>/s)?.[1] ?? "" },
  rules: [], html: "", css: "", js: "",
});
function fixture(responses, configure = () => {}) {
  let nextId = 1000;
  let project = {
    currentSceneId: "main", ratio: "9:16", allowedDomains: [], scenes: [{
      id: "main", name: "Main", parent: null, muted: false, sound: -1,
      clips: [{ id: 10, url: null, srcDur: 10, in: 0, out: 10, speed: 1, zoom: 1,
        mirror: false, color: "#000", width: 320, height: 240, fit: "contain" }],
      texts: [], components: [], audioClips: [],
    }],
  };
  configure(project);
  const original = structuredClone(project);
  const events = [], requests = [], commits = [], prepared = [];
  const adapters = {
    snapshot: () => structuredClone(project), playhead: () => 0,
    selection: () => ({ clipId: null, textId: null, componentId: null, audioId: null }),
    turn: async request => {
      requests.push(structuredClone(request));
      const response = responses.shift();
      assert(response, "Each model turn needs an explicit fixture response");
      return typeof response === "function" ? response(request) : response;
    },
    observe: async (_project, request) => ({ kind: "unavailable", sceneId: request.sceneId,
      requestedKind: request.kind, message: "No media." }),
    prepare: async (before, changes, signal) => {
      const batch = await prepareNativeBatch(before, changes, {
        createId: () => nextId++, advancedEditingEnabled: false, compile: compileTooltip, signal,
      });
      prepared.push(batch);
      return batch;
    },
    commit: (batch, fingerprint) => {
      assert.deepEqual(batch.before, project, "The only commit targets the unchanged live project");
      assert.equal(fingerprint, nativeProjectFingerprint(project));
      commits.push(batch);
      project = structuredClone(batch.project);
    },
    progress: () => {}, report: event => events.push(event),
  };
  return { adapters, original, commits, prepared, requests, events, responses,
    current: () => structuredClone(project), change: () => { project = { ...project, ratio: "16:9" }; } };
}
const run = (f, mode = "edit", input = {}, signal = new AbortController().signal) =>
  runNativeTask({ prompt: "Complete this edit", mode, history: [], ...input }, f.adapters, signal);

test("Ask rejects model edits without preparing or committing", async () => {
  const f = fixture([edit]);
  await assert.rejects(run(f, "ask"), /Ask mode/);
  assert.equal(f.prepared.length, 0);
  assert.equal(f.commits.length, 0);
});

for (const mode of ["plan", "edit"]) {
  test(mode + " creates a component, uses its real generated ID and verifies before one final result", async () => {
    const f = fixture([
      operations({ kind: "component.add", sceneId: "main", componentType: "tooltip", at: 1, duration: 3 }),
      request => {
        assert.deepEqual(f.current(), f.original, "The first prepared step remains private");
        const component = request.project.scenes[0].components[0];
        assert.equal(component.id, "component-1000");
        assert(component.source, "A validated generated component exposes editable source");
        return operations({ kind: "component.content", sceneId: "main", componentId: component.id,
          changes: { text: "The punchline is in the footage" } });
      },
      request => {
        assert.deepEqual(f.current(), f.original, "Verification still cannot see a partial live edit");
        assert.equal(request.project.scenes[0].components[0].content.text, "The punchline is in the footage");
        return answer;
      },
    ]);
    const result = await run(f, mode);
    assert.equal(f.requests.length, 3);
    assert.equal(f.prepared.length, 2);
    assert.equal(f.commits.length, mode === "edit" ? 1 : 0);
    assert.deepEqual(result.batch.before, f.original);
    assert.equal(result.batch.operations.length, 2);
    assert.equal(result.batch.project.scenes[0].components[0].fields.text, "The punchline is in the footage");
    assert.equal(result.message, "Done");
    assert(result.history.some(item => item.role === "user" && item.content === "Complete this edit"));
    assert.deepEqual(f.current(), mode === "edit" ? result.batch.project : f.original);
  });
}

test("playback and export effects merge across steps and wait for final verification", async () => {
  const seek = { kind: "playback.seek", sceneId: "main", time: 2 };
  const pause = { kind: "playback.pause" };
  const f = fixture([
    operations(seek, { kind: "export.prepare", format: "video" }),
    request => {
      assert.equal(f.commits.length, 0, "Export preparation cannot terminate or commit early");
      assert.equal(request.project.ratio, "9:16");
      return operations(pause, { kind: "project.ratio", ratio: "1:1" });
    },
    answer,
  ]);
  const result = await run(f);
  assert.equal(f.requests.length, 3);
  assert.equal(f.commits.length, 1);
  assert.deepEqual(result.batch.playback, [seek, pause]);
  assert.equal(result.batch.exportFormat, "video");
  assert.equal(result.batch.project.ratio, "1:1");
  assert.equal(result.batch.operations.length, 4);
});

test("later edits cannot invalidate retained seek or export effects", async () => {
  const cases = [
    {
      effect: { kind: "playback.seek", sceneId: "main", time: 8 },
      change: { kind: "clip.trim", sceneId: "main", clipId: 10, sourceIn: 0, sourceOut: 5 },
      error: /requested playback position/,
    },
    {
      effect: { kind: "export.prepare", format: "video" },
      change: { kind: "clip.delete", sceneId: "main", clipId: 10 },
      error: /before exporting/,
    },
  ];
  for (const { effect, change, error } of cases) {
    const f = fixture([operations(effect), operations(change), answer]);
    await assert.rejects(run(f), error);
    assert.equal(f.commits.length, 0);
    assert.deepEqual(f.current(), f.original);
  }
});

for (const failure of ["cancel", "stale", "provider"]) {
  test("a later " + failure + " failure discards every earlier prepared step", async () => {
    const controller = new AbortController();
    const f = fixture([edit, () => {
      assert.equal(f.prepared.length, 1);
      assert.deepEqual(f.current(), f.original);
      if (failure === "cancel") controller.abort();
      else if (failure === "stale") f.change();
      else throw new Error("Provider unavailable during verification");
      return answer;
    }]);
    const expected = failure === "cancel" ? { name: "AbortError" }
      : failure === "stale" ? /project changed/i : /Provider unavailable/;
    await assert.rejects(run(f, "edit", {}, controller.signal), expected);
    assert.equal(f.commits.length, 0);
    assert.deepEqual(f.current(), failure === "stale" ? { ...f.original, ratio: "16:9" } : f.original);
  });
}

test("media inspection sees the candidate but live changes still invalidate its results", async () => {
  const f = fixture([edit, inspect(frames)]);
  f.adapters.observe = async candidate => {
    assert.equal(candidate.ratio, "1:1");
    assert.equal(f.current().ratio, "9:16");
    f.change();
    return { kind: "unavailable", sceneId: "main", requestedKind: "frames", message: "No media" };
  };
  await assert.rejects(run(f), /project changed/i);
  assert.equal(f.commits.length, 0);
  assert.equal(f.requests.length, 2);
});

test("repeated prepared operations abort the whole task instead of replaying or committing", async () => {
  const f = fixture([edit, edit, edit]);
  await assert.rejects(run(f), /repeated/i);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.current(), f.original);
});

test("a duplicate tool call receives feedback once and can recover without replaying the edit", async () => {
  const f = fixture([edit, edit, request => {
    assert(request.history.some(item => /historical diagnostic/.test(item.content)));
    assert.equal(request.project.ratio, "1:1");
    return answer;
  }]);
  await run(f);
  assert.equal(f.prepared.length, 1);
  assert.equal(f.commits.length, 1);
});

test("repeated successful media inspection reuses the tool result once", async () => {
  const f = fixture([inspect(transcript), inspect(transcript), request => {
    assert.equal(request.observations[0].text, "Grounded speech");
    assert(request.history.some(item => /reused the already completed/.test(item.content)));
    return answer;
  }]);
  let observations = 0;
  f.adapters.observe = async () => {
    observations++;
    return { ...transcript, text: "Grounded speech", segments: [] };
  };
  await run(f);
  assert.equal(observations, 1, "No second decode or transcription call is performed");
});

test("six unfinished turns cannot commit a partial result", async () => {
  const f = fixture(Array.from({ length: 6 }, (_, index) => operations({
    kind: "text.add", sceneId: "main", text: "Step " + index, start: 0, end: 2,
  })));
  await assert.rejects(run(f), /six|limit|steps|complete/i);
  assert.equal(f.requests.length, 6);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.current(), f.original);
});

test("a local operation failure gets bounded feedback and one corrected attempt", async () => {
  const invalid = operations({ kind: "text.add", sceneId: "main", text: "Title", start: 0, end: 0.05 });
  const f = fixture([invalid, request => {
    assert(request.history.some(item => /at least 0\.1 seconds/.test(item.content)),
      "The actual local validation diagnostic must reach the next model turn");
    assert.equal(request.project.scenes[0].texts.length, 0);
    return operations({ kind: "text.add", sceneId: "main", text: "Title", start: 0, end: 2 });
  }, answer]);
  const result = await run(f);
  assert.equal(f.commits.length, 1);
  assert.equal(result.batch.operations.length, 1, "Rejected operations are not merged into the final batch");
  assert.equal(result.batch.project.scenes[0].texts[0].end, 2);
});

test("a second local validation failure and advanced-required refusal preserve the project", async () => {
  const invalid = operations({ kind: "text.add", sceneId: "main", text: "Title", start: 0, end: 0.05 });
  const f = fixture([edit, invalid, invalid]);
  await assert.rejects(run(f), /at least 0\.1 seconds/);
  assert.equal(f.requests.length, 3);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.current(), f.original);

  const blocked = fixture([edit]);
  const refusal = new AssistantPolicyError("advanced_required", "Enable Advanced for this logic change.");
  blocked.adapters.prepare = async () => { throw refusal; };
  await assert.rejects(run(blocked), error => error === refusal);
  assert.equal(blocked.requests.length, 1, "An explicit preference boundary is not a repair opportunity");
  assert.equal(blocked.commits.length, 0);
});

test("transcript and vision evidence survive unchanged-project follow-ups without retaining images", async () => {
  const rawImage = "data:image/jpeg;base64,PRIVATE_FRAME_BYTES";
  const f = fixture([inspect(transcript), inspect(frames), {
    ...answer, evidence: ["main at 0.5s: a red background"],
  }]);
  f.adapters.observe = async (_project, request) => request.kind === "transcript"
    ? { ...request, text: "Welcome to our shop.", segments: [{ start: 0, end: 1, text: "Welcome to our shop." }] }
    : { kind: "frames", sceneId: "main", start: 0, end: 1, coverage: "video-and-text", note: "fixture",
      frames: [{ sceneTime: 0.5, clipId: 10, sourceTime: 0.5, dataUrl: rawImage, width: 1, height: 1 }] };
  const result = await run(f, "plan");
  assert.equal(result.batch, null);
  assert(f.requests[2].history.some(item => item.content.includes("Welcome to our shop.")));
  assert.equal(f.requests[2].observations[0].frames[0].dataUrl, rawImage);
  assert(result.evidence.some(item => item.content.includes("Welcome to our shop.")));
  assert(result.evidence.some(item => item.content.includes("red background")));
  assert(result.evidence.every(item => nativeEvidenceMatchesProject(item, f.original)));
  assert(!JSON.stringify({ history: result.history, evidence: result.evidence }).includes(rawImage));

  f.responses.push(answer);
  const followUp = await run(f, "plan", { prompt: "Use what you observed", history: result.history, evidence: result.evidence });
  const request = f.requests.at(-1);
  assert(request.history.some(item => item.content.includes("Welcome to our shop.")));
  assert(request.history.some(item => item.content.includes("red background")));
  assert.deepEqual(request.observations, []);
  assert(followUp.evidence.length > 0);

  f.change();
  f.responses.push(answer);
  const changed = await run(f, "plan", { prompt: "Inspect the current edit", history: result.history, evidence: result.evidence });
  assert.equal(changed.evidence.length, 1, "Changing framing invalidates visual evidence but preserves unchanged speech");
  assert.equal(changed.evidence[0].scope, "audio");
  assert(!f.requests.at(-1).history.some(item => /red background/.test(item.content)),
    "Stale visual observations must not leak back through returned conversation history");
});

test("speech learned before an edit survives completion and the next user request", async () => {
  const f = fixture([inspect(transcript), operations({ kind: "text.add", sceneId: "main", text: "Question", start: 0, end: 2 }), answer]);
  f.adapters.observe = async () => ({ ...transcript, text: "The punchline from the actual audio", segments: [] });
  const result = await run(f);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].scope, "audio");
  f.responses.push(request => {
    assert(request.history.some(item => item.content.includes("The punchline from the actual audio")));
    assert.equal(request.project.scenes[0].texts.length, 1);
    return answer;
  });
  await run(f, "plan", { prompt: "Use that punchline", history: result.history, evidence: result.evidence });
});

test("unavailable observations cannot cause repeated inference or media work", async () => {
  const f = fixture([inspect(frames), inspect(frames)]);
  let inspections = 0;
  f.adapters.observe = async () => {
    inspections++;
    return { kind: "unavailable", sceneId: "main", requestedKind: "frames", message: "No media" };
  };
  await assert.rejects(run(f, "plan"), /repeated a tool request/i);
  assert.equal(inspections, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.commits.length, 0);
});

for (const mode of ["plan", "edit"]) {
  test(mode + " discards prepared edits when a genuine blocker remains", async () => {
    const f = fixture([edit, { ...answer, message: "Which ending do you want?", blocked: true }]);
    const result = await run(f, mode);
    assert.equal(result.batch, null);
    assert.equal(f.commits.length, 0);
    assert.deepEqual(f.current(), f.original);
    assert.match(result.message, /Which ending/);
    assert.match(result.message, /No changes were applied/);
  });
}

test("a mixed request preserves its substantive answer alongside the completed batch", async () => {
  const f = fixture([edit, { ...answer, answer: "The speaker says welcome to our shop." }]);
  const result = await run(f, "plan");
  assert.equal(result.batch.project.ratio, "1:1");
  assert.equal(result.answer, "The speaker says welcome to our shop.");
  assert(result.history.some(item => item.content.includes(result.answer)));
  assert.equal(f.commits.length, 0);
});

test("candidate audio edits invalidate earlier transcript evidence before the next planning turn", async () => {
  const prior = "Speech from the original opening";
  const f = fixture([inspect(transcript), operations({ kind: "clip.trim", sceneId: "main", clipId: 10, sourceIn: 2, sourceOut: 10 }), request => {
    assert.equal(request.project.scenes[0].clips[0].sourceIn, 2);
    assert(!request.history.some(item => item.content.includes(prior)), "Trimmed-away speech must not remain authoritative current evidence");
    assert(request.history.some(item => item.content.includes("The creator prefers a short quiz")), "Semantic conversation stays available");
    assert(request.execution.receipts.length > 0, "Actual prepared-step feedback stays available outside conversation history");
    return answer;
  }]);
  f.adapters.observe = async () => ({ ...transcript, text: prior, segments: [{ start: 0.1, end: 0.9, text: prior }] });
  const result = await run(f, "plan", { history: [{ role: "user", content: "The creator prefers a short quiz" }] });
  assert.equal(result.evidence.length, 0);
  assert.equal(f.commits.length, 0);
});

test("candidate visual edits drop stale frame descriptions while preserving unchanged speech", async () => {
  const f = fixture([inspect(transcript), inspect(frames), {
    ...edit, evidence: ["The original portrait framing shows a red title."],
  }, request => {
    assert.equal(request.project.ratio, "1:1");
    assert(!request.history.some(item => /original portrait framing/.test(item.content)));
    assert(request.history.some(item => /Audible speech is unchanged/.test(item.content)));
    assert(request.history.every(item => Object.keys(item).sort().join(",") === "content,role"), "Evidence ownership metadata is local, not an extra wire field");
    return answer;
  }]);
  f.adapters.observe = async (_project, request) => request.kind === "transcript"
    ? { ...transcript, text: "Audible speech is unchanged", segments: [] }
    : { kind: "frames", sceneId: "main", start: 0, end: 1, coverage: "video-and-text", note: "fixture",
      frames: [{ sceneTime: 0.5, clipId: 10, sourceTime: 0.5, dataUrl: "data:image/jpeg;base64,AAAA", width: 1, height: 1 }] };
  const result = await run(f, "plan");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].scope, "audio");
});

test("reordered JSON object keys cannot replay an already prepared text insertion", async () => {
  const add = { kind: "text.add", sceneId: "main", text: "One title only", start: 0, end: 2,
    style: { fill: "#ffffff", bold: true } };
  const reordered = Object.fromEntries(Object.entries({ ...add, style: { bold: true, fill: "#ffffff" } }).reverse());
  const f = fixture([operations(add), operations(reordered), request => {
    assert(request.history.some(item => /historical diagnostic/.test(item.content)));
    assert.equal(request.project.scenes[0].texts.length, 1);
    return answer;
  }]);
  const result = await run(f);
  assert.equal(f.prepared.length, 1);
  assert.equal(f.commits.length, 1);
  assert.equal(result.batch.operations.length, 1);
  assert.equal(f.current().scenes[0].texts.length, 1);
});

test("reordered observation keys reuse existing media without a second decode", async () => {
  const reordered = Object.fromEntries(Object.entries(transcript).reverse());
  const f = fixture([inspect(transcript), inspect(reordered), answer]);
  let decoded = 0;
  f.adapters.observe = async () => {
    decoded++;
    return { ...transcript, text: "Actual observed speech", segments: [] };
  };
  await run(f, "plan");
  assert.equal(decoded, 1);
  assert.equal(f.requests[2].observations[0].text, "Actual observed speech");
});

test("tool signature normalization preserves array order when checking planned edits", async () => {
  const square = { kind: "project.ratio", ratio: "1:1" };
  const wide = { kind: "project.ratio", ratio: "16:9" };
  const f = fixture([operations(square, wide), operations(wide, square), answer]);
  const result = await run(f);
  assert.equal(result.batch.project.ratio, "1:1", "Reversed operation sequences have different effects and cannot be skipped as duplicates");
  assert.equal(f.prepared.length, 2);
  assert.equal(result.batch.operations.length, 4);
});

for (const boundary of ["observation", "preparation"]) {
  test("cancellation after a late " + boundary + " result discards prepared work without starting more effects", async () => {
    const controller = new AbortController();
    const f = fixture([edit, boundary === "observation"
      ? { message: "Inspect two ranges", operations: [], observations: [transcript, { ...transcript, start: 1, end: 2 }] }
      : operations({ kind: "text.add", sceneId: "main", text: "Never applied", start: 0, end: 2 })]);
    let ownedEffects = 0;
    if (boundary === "observation") f.adapters.observe = async () => {
      ownedEffects++;
      controller.abort();
      return { ...transcript, text: "Late speech result", segments: [] };
    };
    else {
      const prepare = f.adapters.prepare;
      f.adapters.prepare = async (...args) => {
        const batch = await prepare(...args);
        if (++ownedEffects === 2) controller.abort();
        return batch;
      };
    }
    await assert.rejects(run(f, "edit", {}, controller.signal), { name: "AbortError" });
    assert.equal(ownedEffects, boundary === "observation" ? 1 : 2);
    assert.equal(f.commits.length, 0);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.current(), f.original);
    assert(!f.events.some(event => event.applied || event.observation), "Late results cannot be reported as completed user work");
  });
}

test("the seventh distinct media inspection stops before decoding and discards earlier prepared edits", async () => {
  const observation = index => ({ ...transcript, start: index, end: index + 1 });
  const f = fixture([edit,
    { message: "Read four sections", operations: [], observations: [0, 1, 2, 3].map(observation) },
    { message: "Read three more", operations: [], observations: [4, 5, 6].map(observation) },
  ]);
  let decoded = 0;
  f.adapters.observe = async (_project, request) => {
    decoded++;
    return { ...request, text: `Section ${request.start}`, segments: [] };
  };
  await assert.rejects(run(f), error => error.reason === "inspection_limit");
  assert.equal(decoded, 6);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.current(), f.original);
});

test("a reverted result can be legitimately prepared again instead of being rejected as a historical duplicate", async () => {
  const requested = { kind: "text.update", sceneId: "main", textId: 20, changes: { text: "Updated", start: 1, end: 3 } };
  const restore = { kind: "text.update", sceneId: "main", textId: 20, changes: { text: "Original", start: 3, end: 5 } };
  const f = fixture([operations(requested), operations(restore), operations(requested), request => {
    assert.equal(request.project.scenes[0].texts[0].text, "Updated");
    assert.equal(request.project.scenes[0].texts[0].start, 1);
    assert.equal(request.execution.receipts.length, 3);
    assert(!request.history.some(item => /historical diagnostic/.test(item.content)));
    return answer;
  }], project => { project.scenes[0].texts = [{ id: 20, text: "Original", start: 3, end: 5, x: 50, y: 20, color: 0 }]; });
  await run(f);
  assert.equal(f.prepared.length, 3);
  assert.equal(f.commits.length, 1);
  assert.equal(f.current().scenes[0].texts[0].text, "Updated");
});

test("a generated identity still prevents duplicate insertion after its content has changed", async () => {
  const create = { kind: "text.add", sceneId: "main", text: "First wording", start: 0, end: 3 };
  const f = fixture([operations(create), operations({ kind: "text.update", sceneId: "main", textId: 1000,
    changes: { text: "Revised wording" } }), operations(create), request => {
    assert.equal(request.project.scenes[0].texts.length, 1);
    assert.equal(request.project.scenes[0].texts[0].text, "Revised wording");
    assert(request.history.some(item => /historical diagnostic about that candidate version/.test(item.content)));
    assert(!request.history.some(item => /Their result is already present in the current working copy/.test(item.content)));
    return answer;
  }]);
  await run(f);
  assert.equal(f.prepared.length, 2);
  assert.equal(f.commits.length, 1);
  assert.equal(f.current().scenes[0].texts.length, 1);
});

test("unrelated field edits do not make an already satisfied update necessary again", async () => {
  const move = { kind: "text.update", sceneId: "main", textId: 20, changes: { start: 1, end: 3 } };
  const f = fixture([operations(move), operations({ kind: "text.update", sceneId: "main", textId: 20,
    changes: { text: "Revised wording" } }), operations(move), answer], project => {
    project.scenes[0].texts = [{ id: 20, text: "Original", start: 3, end: 5, x: 50, y: 20, color: 0 }];
  });
  await run(f);
  assert.equal(f.prepared.length, 2);
  assert.equal(f.current().scenes[0].texts[0].start, 1);
  assert.equal(f.current().scenes[0].texts[0].text, "Revised wording");
});

test("a later deferred seek or playback state permits restoring the earlier scheduled value", async () => {
  const seek = { kind: "playback.seek", sceneId: "main", time: 2 };
  const pause = { kind: "playback.pause" };
  const f = fixture([
    operations(seek, pause, { kind: "export.prepare", format: "pvo" }),
    operations({ kind: "playback.seek", sceneId: "main", time: 4 }, { kind: "playback.play" }, { kind: "export.prepare", format: "video" }),
    operations(seek, pause, { kind: "export.prepare", format: "pvo" }), answer,
  ]);
  const result = await run(f);
  assert.equal(f.prepared.length, 3);
  assert.equal(result.batch.playback.at(-2).time, 2);
  assert.equal(result.batch.playback.at(-1).kind, "playback.pause");
  assert.equal(result.batch.exportFormat, "pvo");
});

test("repeated no-op proposals remain bounded and cannot commit an unfinished request", async () => {
  const noop = operations({ kind: "project.ratio", ratio: "9:16" });
  const f = fixture(Array.from({ length: 6 }, () => noop));
  await assert.rejects(run(f), /six steps/);
  assert.equal(f.requests.length, 6);
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.current(), f.original);
});
