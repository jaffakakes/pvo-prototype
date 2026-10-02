import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createAlignmentServer } from "../scripts/dev/mfa/server.mjs";
import { createMfaRunner } from "../scripts/dev/mfa/process.mjs";
import { parseAlignmentInput, parseAlignmentOutput } from "../scripts/dev/mfa/contract.mjs";

const token = "private-sidecar-test-token-with-32-characters";
const provenance = {
  method: "forced_alignment", engine: "mfa", version: "3.4.2+pvo.refinement.1",
  acousticModel: "english_mfa@3.1.0", dictionary: "english_mfa", language: "en",
  transcriptVerified: false, refined: true,
};

function wav(silent = false) {
  const bytes = Buffer.alloc(32044);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(32000, 40);
  if (!silent) for (let index = 44; index < bytes.length; index += 2) bytes.writeInt16LE(100, index);
  return bytes.toString("base64");
}

const input = () => ({ audio: wav(), duration: 1, text: "Hello world.", language: "en" });
const result = () => ({ text: "Hello world.", words: [
  { text: "hello", start: 0.1, end: 0.4 }, { text: "world", start: 0.5, end: 0.9 },
], provenance });

test("runner requires actual refinement completion rather than successful ordinary alignment", () => {
  execFileSync("python3", ["-B", "-c", `
import importlib.util
from pathlib import Path
path = Path('scripts/dev/mfa/runner.py')
spec = importlib.util.spec_from_file_location('mfa_runner_test', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
complete = 'INFO Fine tuning alignments...\\n 100% bar 1/1 [time]\\nINFO Analyzing alignment quality...\\n'
assert module.refinement_completed(complete)
assert not module.refinement_completed(complete.replace('100% bar 1/1', '0% bar 0/1'))
assert not module.refinement_completed('100% bar 1/1\\nINFO Analyzing alignment quality...')
assert not module.refinement_completed('INFO Fine tuning alignments...\\n0% 0/1\\nINFO Analyzing alignment quality...\\n100% 1/1')
`], { stdio: "pipe" });
});

async function serverFixture(t, runAlignment) {
  const server = createAlignmentServer({ token, runAlignment });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.cancelAlignment(); server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/align`;
  const send = (body = input(), headers = {}) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { server, url, send };
}

test("MFA input rejects malformed WAVs, silence, unbounded or unsupported transcript requests", () => {
  assert.deepEqual(parseAlignmentInput(input()), input());
  const invalid = [
    { audio: wav(true) }, { duration: 2 }, { duration: 61 }, { language: "yo" },
    { audio: "@@@@" }, { audio: Buffer.from("not a wav").toString("base64") },
    { text: "word ".repeat(301) }, { text: "x".repeat(4001) }, { text: "" }, { extra: true },
  ];
  const wrongRate = Buffer.from(wav(), "base64");
  wrongRate.writeUInt32LE(48000, 24);
  invalid.push({ audio: wrongRate.toString("base64") });
  for (const patch of invalid) assert.throws(() => parseAlignmentInput({ ...input(), ...patch }), error => error.status === 422);
});

test("MFA output requires complete supplied word coverage and honest refinement provenance", () => {
  assert.deepEqual(parseAlignmentOutput(result(), input()), result());
  for (const output of [
    { ...result(), words: result().words.slice(1) },
    { ...result(), words: [...result().words].reverse() },
    { ...result(), words: [{ text: "hello", start: 0, end: 2 }, result().words[1]] },
    { ...result(), words: [{ text: "hello", start: NaN, end: 0.4 }, result().words[1]] },
    { ...result(), provenance: { ...provenance, transcriptVerified: true } },
    { ...result(), provenance: { ...provenance, refined: false } },
  ]) assert.throws(() => parseAlignmentOutput(output, input()), error => error.code === "alignment_incomplete");
});

test("loopback service authenticates before invoking alignment and hides private exceptions", async (t) => {
  let calls = 0;
  const fixture = await serverFixture(t, async () => { calls += 1; throw new Error("private transcript and secret"); });
  assert.equal((await fixture.send(input(), { Authorization: "wrong" })).status, 401);
  assert.equal(calls, 0);
  const failed = await fixture.send();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: { code: "alignment_unavailable" } });
  assert.equal(calls, 1);
});

test("one active alignment rejects concurrent work and client cancellation releases the slot", async (t) => {
  let started;
  let cancelled;
  const began = new Promise(resolve => { started = resolve; });
  const ended = new Promise(resolve => { cancelled = resolve; });
  const fixture = await serverFixture(t, async (_input, signal) => {
    started();
    return new Promise((resolve) => signal.addEventListener("abort", () => { cancelled(); resolve(result()); }, { once: true }));
  });
  const controller = new AbortController();
  const first = fetch(fixture.url, { method: "POST", signal: controller.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input()) });
  const rejected = assert.rejects(first, error => error.name === "AbortError");
  await began;
  assert.equal((await fixture.send()).status, 429);
  controller.abort();
  await Promise.all([ended, rejected]);
  assert.equal((await fixture.send({ ...input(), language: "unsupported" })).status, 422);
});

async function processFixture(t, script, timeoutMs = 1000) {
  const root = await mkdtemp(path.join(tmpdir(), "pvo-mfa-process-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "bin"));
  await symlink(process.execPath, path.join(root, "bin/python"));
  const runner = path.join(root, "fixture.mjs");
  await writeFile(runner, script);
  const runtimeRoot = path.join(root, "mfa-root");
  const run = createMfaRunner({ root: runtimeRoot, mfa: path.join(root, "bin/mfa"), runner, timeoutMs });
  return { root, jobs: path.join(root, "alignment-jobs"), run };
}

test("subprocess success validates result and removes private input directories", async (t) => {
  const f = await processFixture(t, `
    const value = flag => process.argv[process.argv.indexOf(flag) + 1];
    if (value("--job").startsWith(value("--root"))) throw new Error("MFA rejects any corpus path starting with its global root string");
    process.stdin.resume();
    process.stdin.on("end", () => console.log(${JSON.stringify(JSON.stringify(result()))}));
  `);
  assert.deepEqual(await f.run(input(), new AbortController().signal), result());
  assert.deepEqual(await readdir(f.jobs), []);
});

test("deadline kills the whole subprocess group and removes temporary files", async (t) => {
  const f = await processFixture(t, `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    import path from "node:path";
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "inherit" });
    writeFileSync(path.join(path.dirname(process.argv[1]), "child-pid"), String(child.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `, 250);
  await assert.rejects(f.run(input(), new AbortController().signal), error => error.code === "alignment_timeout");
  const pid = Number(await readFile(path.join(f.root, "child-pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
  assert.deepEqual(await readdir(f.jobs), []);
});

test("aborting a running subprocess rejects and cleans its job directory", async (t) => {
  const f = await processFixture(t, "process.stdin.resume(); setInterval(() => {},1000);", 5000);
  const controller = new AbortController();
  const promise = f.run(input(), controller.signal);
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(promise, error => error.code === "alignment_cancelled");
  assert.deepEqual(await readdir(f.jobs), []);
});
