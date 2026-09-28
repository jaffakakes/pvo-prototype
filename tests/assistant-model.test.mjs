import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initSync } from "../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../packages/pvo-language/index.js";
import { runAssistantModel } from "../server/assistant/model.js";
import { proposeAssistantChange } from "../server/assistant/service.js";
import { assistantDraft, assistantInput } from "./assistant-server.helpers.mjs";

initSync({ module: new WebAssembly.Module(await readFile(new URL("../packages/pvo-language/pkg/pvo_language_bg.wasm", import.meta.url))) });
const signal = () => new AbortController().signal;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("Workers AI object/string envelopes use the same strict wire validation", async () => {
  for (const value of [assistantDraft(), JSON.stringify(assistantDraft())]) {
    const response = await runAssistantModel({ run: async () => ({ response: value }) }, [], signal());
    assert.deepEqual(response, assistantDraft());
  }
  for (const value of ["```json\n{}\n```", { ...assistantDraft(), extra: true }, { ...assistantDraft(), followUps: [] }])
    await assert.rejects(runAssistantModel({ run: async () => ({ response: value }) }, [], signal()), error => error.status === 422);
  await assert.rejects(runAssistantModel({ run: async () => ({ response: assistantDraft(), tool_calls: [{ name: "fetch" }] }) }, [], signal()), error => error.status === 422);
});

test("provider errors expose curated statuses and never echo or log prompt-bearing failures", async t => {
  const warnings = [];
  t.mock.method(console, "warn", value => warnings.push(JSON.parse(value)));
  for (const [error, status] of [[{ status: 429 }, 429], [{ internalCode: 3036 }, 429], [new Error("private source in failure"), 503]]) {
    await assert.rejects(runAssistantModel({ run: async () => { throw error; } }, [], signal()), rejected => {
      assert.equal(rejected.status, status);
      assert.ok(!rejected.message.includes("private source"));
      return true;
    });
  }
  assert.equal(warnings.length, 3);
  assert.deepEqual(Object.keys(warnings[0]).sort(), ["code", "model", "name", "status"]);
  assert.ok(!JSON.stringify(warnings).includes("private source"));
});

test("an inference timeout aborts the binding and cannot start repair when a late result arrives", async () => {
  let reserved = 0;
  let calls = 0;
  let upstreamSignal;
  let finish;
  const pending = proposeAssistantChange(assistantInput(), {
    compile: compilePvoComponent,
    reserve: async () => { reserved++; },
    run: (_messages, candidateSignal) => {
      calls++; upstreamSignal = candidateSignal;
      return new Promise(resolve => { finish = resolve; });
    },
    signal: signal(), attemptMs: 15, totalMs: 100,
  });
  await assert.rejects(pending, error => error.status === 504);
  assert.equal(upstreamSignal.aborted, true);
  finish(assistantDraft());
  await sleep(10);
  assert.equal(calls, 1);
  assert.equal(reserved, 1);
});

test("overall timeout bounds a stalled quota reservation and prevents late inference", async () => {
  let release;
  let calls = 0;
  const pending = proposeAssistantChange(assistantInput(), {
    compile: compilePvoComponent,
    reserve: () => new Promise(resolve => { release = resolve; }),
    run: async () => { calls++; return assistantDraft(); },
    signal: signal(), attemptMs: 100, totalMs: 15,
  });
  await assert.rejects(pending, error => error.status === 504);
  release();
  await sleep(10);
  assert.equal(calls, 0);
});

test("client cancellation preserves the original source and prevents later inference", async () => {
  const input = assistantInput();
  const original = structuredClone(input);
  const controller = new AbortController();
  let calls = 0;
  controller.abort();
  await assert.rejects(proposeAssistantChange(input, {
    compile: compilePvoComponent, reserve: async () => {},
    run: async () => { calls++; return assistantDraft(); }, signal: controller.signal,
  }), error => error.status === 400);
  assert.equal(calls, 0);
  assert.deepEqual(input, original);
});

test("client cancellation during inference aborts the active call and ignores its late result", async () => {
  const controller = new AbortController();
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  let upstreamSignal;
  let finish;
  let calls = 0;
  const pending = proposeAssistantChange(assistantInput(), {
    compile: compilePvoComponent, reserve: async () => {},
    run: (_messages, candidateSignal) => {
      calls++; upstreamSignal = candidateSignal; ready();
      return new Promise(resolve => { finish = resolve; });
    },
    signal: controller.signal, attemptMs: 100, totalMs: 200,
  });
  await started;
  controller.abort();
  await assert.rejects(pending, error => error.status === 400);
  assert.equal(upstreamSignal.aborted, true);
  finish(assistantDraft());
  await sleep(5);
  assert.equal(calls, 1);
});

test("repair shares the overall deadline instead of starting a fresh total budget", async () => {
  let calls = 0;
  let secondSignal;
  const rejected = assistantDraft();
  rejected.source.style = "card { opacity: 0; }";
  await assert.rejects(proposeAssistantChange(assistantInput(), {
    compile: compilePvoComponent, reserve: async () => {},
    run: async (_messages, candidateSignal) => {
      if (++calls === 1) { await sleep(10); return rejected; }
      secondSignal = candidateSignal;
      return new Promise(() => {});
    },
    signal: signal(), attemptMs: 100, totalMs: 40,
  }), error => error.status === 504);
  assert.equal(calls, 2);
  assert.equal(secondSignal.aborted, true);
});
