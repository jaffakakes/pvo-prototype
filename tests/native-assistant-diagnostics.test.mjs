import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: { contents: "export { runNativeTask } from './editor/src/infrastructure/assistant/runNativeTask.ts';", resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { runNativeTask } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

function fixture(trace) {
  const project = { currentSceneId: "main", ratio: "9:16", allowedDomains: [], scenes: [
    { id: "main", name: "Private project title", parent: null, muted: false, sound: -1,
      clips: [], texts: [], components: [], audioClips: [] },
  ] };
  return {
    snapshot: () => project, playhead: () => 0,
    selection: () => ({ clipId: null, textId: null, componentId: null, audioId: null }),
    turn: async () => ({ message: "Private answer", operations: [], observations: [] }),
    prepare: async (_before, operations) => ({ before: project, project: { ...project, ratio: "1:1" }, operations, receipts: [{ operation: "project.ratio", target: { kind: "project" }, outcome: "prepared",
      changes: [{ before: { kind: "project", values: { ratio: project.ratio, canvas: { width: 1080, height: 1920 } } },
        after: { kind: "project", values: { ratio: "1:1", canvas: { width: 1080, height: 1080 } } } }] }], playback: [], exportFormat: null }),
    observe: async () => { throw new Error("Unexpected observation"); },
    commit: () => {}, progress: () => {}, report: () => {}, trace,
  };
}
const input = { prompt: "Private user request", mode: "plan", history: [] };

test("assistant traces describe lifecycle and exact loop failure without private content", async () => {
  const trace = [];
  const adapters = fixture(event => trace.push(event));
  adapters.turn = async () => ({ message: "Private wording", operations: [{ kind: "project.ratio", ratio: "1:1" }], observations: [] });
  await assert.rejects(runNativeTask(input, adapters, new AbortController().signal), error => error.reason === "repeated_edit");
  assert.deepEqual(trace.at(-1), { stage: "request", status: "failed", reason: "repeated_edit" });
  assert(trace.some(event => event.stage === "preparation" && event.status === "completed" && event.changed));
  assert.doesNotMatch(JSON.stringify(trace), /Private|user request|wording|title/);
});

test("a failing diagnostic observer cannot reject a completed editor request", async () => {
  const result = await runNativeTask(input, fixture(() => { throw new Error("Observer is unavailable"); }), new AbortController().signal);
  assert.equal(result.message, "Private answer");
  assert.equal(result.batch, null);
});
