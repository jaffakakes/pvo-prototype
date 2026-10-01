import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { contents: `
  export * from './editor/src/state/debugging/tryDebugStore.ts';
  export * from './editor/src/domain/debugging/selectors.ts';
  export * from './editor/src/domain/debugging/media.ts';
  export { sourceRevision } from './editor/src/domain/debugging/components.ts';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser" });
const debug = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function input(projectId = "project-1") {
  return { projectId, sceneId: "main", videoTime: 3, requested: true, scenes: [{ id: "main", name: "Main", parent: null,
    clips: [{ id: 1, in: 0, out: 10, speed: 1 }], texts: [], muted: false, sound: 0,
    components: [{ id: "question", sceneId: "main", type: "choice", at: 0, dur: 10, fields: { prompt: "Question", options: [{ label: "Yes", outcome: { kind: "continue" } }] },
      responsePolicy: { dispatch: "interaction", unanswered: "continue" } }] }] };
}
const current = () => debug.useTryDebugStore.getState().run;

test("Try records before opening Debug, preserves the last run, and rejects late events", () => {
  const first = debug.startDebugRun(input());
  debug.recordDebugEvent(first, { type: "interaction.received", componentId: "question", interactionId: "first" });
  debug.stopDebugRun(first);
  const stopped = current();
  assert.equal(stopped.status, "stopped");
  assert(stopped.records.some(event => event.type === "interaction.received"));
  debug.recordDebugEvent(first, { type: "request.completed", requestId: "late" });
  assert.equal(current(), stopped);
  const next = debug.startDebugRun(input());
  debug.recordDebugEvent(first, { type: "request.failed", requestId: "old" });
  assert.equal(current().id, next);
  assert.equal(current().requests.length, 0);
  debug.syncDebugContext({ ...input("another-project"), holdingId: null });
  assert.equal(current(), null);
});

test("an HTTP failure stays visible when an enclosing action also fails or completes", () => {
  const id = debug.startDebugRun(input());
  const identity = { componentId: "question", interactionId: "press", requestId: "request-1" };
  debug.recordDebugEvent(id, { ...identity, type: "interaction.received", target: "Yes" });
  debug.recordDebugEvent(id, { ...identity, type: "request.started", method: "GET", url: "https://example.com/scores" });
  debug.recordDebugEvent(id, { ...identity, type: "request.failed", status: 404, durationMs: 34,
    failure: { kind: "http", status: 404, message: "Request address not found (404)." } });
  debug.recordDebugEvent(id, { ...identity, type: "action.failed", reason: "action_error" });
  debug.recordDebugEvent(id, { ...identity, type: "action.completed" });
  const group = debug.groupInteractions(current()).find(item => item.id === "press");
  assert.equal(group.resultLabel, "Failed · 404");
  assert.match(group.why, /server answered/i);
  assert.equal(current().pendingRequests, 0);
});

test("a successful later request cannot erase an earlier failed request in the same interaction", () => {
  const id = debug.startDebugRun(input());
  const context = { componentId: "question", interactionId: "press", method: "GET" };
  debug.recordDebugEvent(id, { ...context, type: "request.started", requestId: "failed-first", url: "https://example.com/first" });
  debug.recordDebugEvent(id, { ...context, type: "request.failed", requestId: "failed-first", status: 404, failure: { kind: "http", status: 404, message: "Request address not found (404)." } });
  debug.recordDebugEvent(id, { ...context, type: "request.started", requestId: "succeeded-later", url: "https://example.com/recovery" });
  debug.recordDebugEvent(id, { ...context, type: "request.completed", requestId: "succeeded-later", status: 200 });
  const group = debug.groupInteractions(current()).find(item => item.id === "press");
  assert.equal(group.resultLabel, "Failed · 404");
  assert.equal(current().requests.find(request => request.id === "succeeded-later").result, "done");
  assert(group.stages.some(stage => stage.label === "Server returned 200"));
});

test("a held retry uses its current attempt and a fresh answer hold ignores historical failure", () => {
  const source = input();
  const id = debug.startDebugRun(source);
  debug.recordDebugEvent(id, { type: "media.paused" });
  debug.recordDebugEvent(id, { type: "playback.hold", componentId: "question", reason: "layer_end" });
  debug.recordDebugEvent(id, { type: "request.started", requestId: "first", interactionId: "first", componentId: "question", url: "https://example.com/score" });
  debug.recordDebugEvent(id, { type: "request.failed", requestId: "first", interactionId: "first", componentId: "question", status: 404 });
  assert.equal(debug.deriveStatus(current()).state, "failed");
  debug.recordDebugEvent(id, { type: "request.started", requestId: "retry", interactionId: "retry", componentId: "question", url: "https://example.com/score" });
  assert.equal(debug.deriveStatus(current()).state, "held");
  assert.equal(debug.deriveStatus(current()).requestsRunning, 1);
  debug.recordDebugEvent(id, { type: "request.failed", requestId: "retry", interactionId: "retry", componentId: "question", status: 503 });
  debug.recordDebugEvent(id, { type: "playback.hold", componentId: "question", reason: "awaiting_answer" });
  assert.equal(debug.deriveStatus(current()).state, "held");
  assert.match(debug.deriveStatus(current()).title, /waiting for/);
  debug.recordDebugEvent(id, { type: "interaction.accepted", componentId: "question", interactionId: "new-answer" });
  debug.recordDebugEvent(id, { type: "request.started", requestId: "new-answer", interactionId: "new-answer", componentId: "question", url: "https://example.com/score" });
  debug.recordDebugEvent(id, { type: "request.failed", requestId: "new-answer", interactionId: "new-answer", componentId: "question", status: 404 });
  assert.equal(debug.deriveStatus(current()).state, "failed");
});

test("releasing a hold does not claim the video played before a play rejection", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "playback.released", componentId: "question", interactionId: "continue" });
  debug.recordDebugEvent(id, { type: "media.play_rejected", reason: "play_rejected" });
  const group = debug.groupInteractions(current()).find(item => item.id === "continue");
  assert.equal(group.stages[0].label, "Playback hold released");
  assert.equal(debug.deriveStatus(current()).state, "waiting");
});

test("clearing completed groups preserves a running request and current state", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "interaction.received", interactionId: "done", componentId: "question" });
  debug.recordDebugEvent(id, { type: "action.completed", interactionId: "done", componentId: "question" });
  debug.recordDebugEvent(id, { type: "request.started", interactionId: "pending", requestId: "pending", componentId: "question", url: "https://example.com/score" });
  debug.publishDebugState(id, { score: 4 });
  assert.equal(debug.clearCompletedDebugActivity(), 1);
  assert(current().records.some(event => event.type === "session.started"));
  assert(current().records.some(event => event.requestId === "pending"));
  assert.equal(current().currentState.score, 4);
});

test("clear completed preserves a failed interaction that still contains a running request", () => {
  const id = debug.startDebugRun(input());
  const context = { componentId: "question", interactionId: "press", method: "GET" };
  debug.recordDebugEvent(id, { ...context, type: "request.started", requestId: "first", url: "https://example.com/first" });
  debug.recordDebugEvent(id, { ...context, type: "request.failed", requestId: "first", status: 404 });
  debug.recordDebugEvent(id, { ...context, type: "request.started", requestId: "recovery", url: "https://example.com/recovery" });
  assert.equal(debug.clearCompletedDebugActivity(), 0);
  const group = debug.groupInteractions(current()).find(item => item.id === "press");
  assert.equal(group.result, "failed");
  assert(group.records.some(record => record.requestId === "recovery" && record.type === "request.started"));
  assert.equal(current().requests.length, 2);
  assert.equal(current().pendingRequests, 1);
});

test("clear completed preserves the request failure that still owns the current hold", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "media.paused" });
  debug.recordDebugEvent(id, { type: "playback.hold", componentId: "question", reason: "awaiting_answer" });
  const context = { componentId: "question", interactionId: "press", requestId: "failed" };
  debug.recordDebugEvent(id, { ...context, type: "request.started", url: "https://example.com/failure" });
  debug.recordDebugEvent(id, { ...context, type: "request.failed", status: 404 });
  const status = debug.deriveStatus(current());
  debug.clearCompletedDebugActivity();
  assert.equal(debug.deriveStatus(current()).title, status.title);
  assert.equal(debug.deriveStatus(current()).state, "failed");
  assert(current().requests.some(request => request.id === "failed"));
  assert(debug.groupInteractions(current()).some(group => group.id === "press"));
  debug.stopDebugRun(id);
  debug.clearCompletedDebugActivity();
  assert.equal(current().requests.length, 0, "The retained last run has no live hold to protect");
});

test("an omitted request's completion does not increment the overflow count again", () => {
  const id = debug.startDebugRun(input());
  for (let index = 0; index < 201; index++) debug.recordDebugEvent(id, {
    type: "request.started", requestId: `request-${index}`, interactionId: `press-${index}`, url: "https://example.com/pending",
  });
  assert.equal(current().requests.length, 200);
  assert.equal(current().requestOverflow, 1);
  assert(!current().requests.some(request => request.id === "request-0"));
  debug.recordDebugEvent(id, { type: "request.completed", requestId: "request-0", interactionId: "press-0", status: 200 });
  assert.equal(current().requestOverflow, 1);
  assert.equal(current().pendingRequests, 200);
  const report = JSON.parse(debug.buildDebugReport());
  assert.equal(report.requestOverflow, 1);
  assert.equal(report.componentOverflow, 0);
  assert.equal(report.pendingRequests, 200);
});

test("current values are masked at ingestion and copied reports exclude data and query secrets", () => {
  const id = debug.startDebugRun(input());
  debug.publishDebugState(id, { score: 3, name: "Ada", form: { number: 1234 }, response: { token: "secret-value", names: ["Ada"] } });
  const rows = debug.stateRows(current());
  assert.equal(rows.find(row => row.path === "score").displayValue, "3");
  assert(rows.find(row => row.path === "name").masked);
  assert(!JSON.stringify(current().currentState).includes("Ada"));
  debug.recordDebugEvent(id, { type: "request.started", requestId: "test", interactionId: "press", url: "https://user:password@example.com/scores?token=secret-value", requestBody: { score: 3 }, captured: true });
  const report = debug.buildDebugReport();
  assert(!report.includes("secret-value"));
  assert(!report.includes("password"));
  assert(!report.includes("requestBody"));
  assert(!report.includes("currentState"));
  assert.equal(current().requests[0].path, "/scores");
});

test("media observation, requested playback and simultaneous requests stay distinct", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "request.started", requestId: "a", url: "https://example.com/a" });
  debug.recordDebugEvent(id, { type: "request.started", requestId: "b", url: "https://example.com/b" });
  assert.equal(debug.deriveStatus(current()).state, "waiting");
  debug.recordDebugEvent(id, { type: "media.playing" });
  const status = debug.deriveStatus(current());
  assert.equal(status.state, "playing");
  assert.equal(status.requestsRunning, 2);
  debug.recordDebugEvent(id, { type: "media.play_rejected", reason: "play_rejected" });
  assert.equal(debug.deriveStatus(current()).state, "waiting");
});

test("long runs stay bounded without hiding pending request summaries", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "request.started", requestId: "held", interactionId: "held", url: "https://example.com/held" });
  for (let index = 0; index < 820; index++) debug.recordDebugEvent(id, { type: "action.started", interactionId: "held", label: "x".repeat(300) });
  assert(current().records.length <= 700);
  assert(JSON.stringify(current().records).length <= 350000);
  assert(current().discarded > 0);
  assert.equal(current().requests[0].result, "running");
  assert.equal(current().pendingRequests, 1);
});

test("source identity includes response timing and no-action readiness does not invent a tap", () => {
  const source = input();
  const component = source.scenes[0].components[0];
  const first = debug.sourceRevision(component);
  component.responsePolicy.dispatch = "layer_end";
  assert.notEqual(debug.sourceRevision(component), first);
  component.code = { custom: true, pvo: { structure: "choice {}", style: "", logic: "" }, pvoCompiled: { structure: { type: "choice", prompt: "Question", options: [] }, rules: [] } };
  debug.startDebugRun(source);
  assert(current().records.some(record => record.type === "component.no_action"));
  assert(!current().records.some(record => record.type === "interaction.received"));
  assert.equal(debug.componentReadiness(current())[0].lastInput, undefined);
});

test("uncached custom source has unknown action readiness until compilation proves it", () => {
  const source = input();
  source.scenes[0].components[0].code = { custom: true, pvo: { structure: "choice {}", style: "", logic: "" } };
  const id = debug.startDebugRun(source);
  assert.equal(current().components[0].actionKnown, false);
  assert(!current().records.some(record => record.type === "component.no_action"));
  debug.recordDebugEvent(id, { type: "component.ready", componentId: "question", reason: "action_assigned" });
  assert.equal(current().components[0].hasAction, true);
  assert.equal(current().components[0].actionKnown, true);
});

test("timeline-clock pauses are observed without pretending an HTML video paused", () => {
  const source = input();
  const id = debug.startDebugRun(source);
  debug.recordDebugEvent(id, { type: "media.playing", reason: "timeline_clock" });
  debug.recordDebugEvent(id, { type: "playback.hold", componentId: "question", reason: "awaiting_answer" });
  debug.syncDebugContext({ ...source, requested: false, holdingId: "question" });
  assert.equal(debug.deriveStatus(current()).state, "held");
  assert.equal(current().playback.observed, "paused");
  assert.equal(current().playback.clock, "timeline");
});

test("readiness reports the actual already-dispatched gate instead of promising another action", () => {
  const source = input();
  debug.startDebugRun(source);
  debug.syncDebugContext({ ...source, holdingId: null, dispatchedIds: ["question"] });
  const component = debug.componentReadiness(current())[0];
  assert.equal(component.interactive, false);
  assert.match(component.interactiveLabel, /already ran/);
});

test("elapsed diagnostic time and report duration do not follow wall-clock adjustments", async t => {
  let wall = 1_000_000;
  t.mock.method(Date, "now", () => wall);
  const id = debug.startDebugRun(input());
  await new Promise(resolve => setTimeout(resolve, 5));
  debug.recordDebugEvent(id, { type: "action.started", interactionId: "test" });
  const before = current().elapsedMs;
  wall = 0;
  debug.recordDebugEvent(id, { type: "action.completed", interactionId: "test" });
  assert(current().elapsedMs >= before);
  assert(JSON.parse(debug.buildDebugReport()).durationMs >= before);
});

test("status does not invent a user pause and distinguishes a media failure from waiting", () => {
  const source = input();
  const id = debug.startDebugRun({ ...source, requested: false });
  assert.equal(debug.deriveStatus(current()).title, "Paused");
  debug.recordDebugEvent(id, { type: "playback.hold", componentId: "question", reason: "awaiting_answer" });
  assert.match(debug.deriveStatus(current()).title, /^Playback held/);
  debug.recordDebugEvent(id, { type: "media.error" });
  assert.equal(debug.deriveStatus(current()).title, "Media could not play");
  assert.equal(debug.deriveStatus(current()).state, "failed");
});

test("skipped condition and unmatched branch stages retain their known reason", () => {
  const id = debug.startDebugRun(input());
  debug.recordDebugEvent(id, { type: "action.skipped", interactionId: "condition", reason: "condition_false" });
  debug.recordDebugEvent(id, { type: "action.skipped", interactionId: "branch", reason: "no_matching_branch" });
  const groups = debug.groupInteractions(current());
  assert.match(groups.find(group => group.id === "condition").stages[0].detail, /condition was false/);
  assert.match(groups.find(group => group.id === "branch").stages[0].detail, /No branch matched/);
});

test("final-frame media observation remains active except for an actual scene tail", () => {
  assert.equal(debug.mediaOwnsDiagnosticClock(6, 6, 6, true), true);
  assert.equal(debug.mediaOwnsDiagnosticClock(6, 6, 8, true), false);
  assert.equal(debug.mediaOwnsDiagnosticClock(5.99, 6, 8, true), true);
  assert.equal(debug.mediaOwnsDiagnosticClock(3, 6, 6, false), false);
});

test("metadata and seek completion sample the actual paused element while held", () => {
  const sample = { paused: true, seeking: false, ended: false, readyState: 2, failed: false };
  assert.equal(debug.observedMediaEvent(sample), "media.paused");
  assert.equal(debug.observedMediaEvent({ ...sample, seeking: true }), "media.seeking");
  assert.equal(debug.observedMediaEvent({ ...sample, paused: false, readyState: 4 }), "media.playing");
  assert.equal(debug.observedMediaEvent({ ...sample, paused: false }, true), "media.waiting");
  assert.equal(debug.observedMediaEvent({ ...sample, failed: true }), "media.error");
});
