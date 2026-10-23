import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalNodeProbe } from "./local-container.mjs";
import { NODE_RUNTIME } from "../../../server/cloud-services/node/runtime.js";
import { dockerContainer } from "./docker.mjs";

const directory = await mkdtemp(join(tmpdir(), "restyle-node-proof-"));
const record = {
  runtime: NODE_RUNTIME,
  localCpu: 1,
  localArchitecture: "amd64 on Apple Silicon emulation",
  startedAt: new Date().toISOString(),
  containers: [],
  checks: [],
};
const save = () =>
  writeFile(
    join(directory, "report.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
import dependency from "../../../packages/pvo-assistant/services/libraries/nanoid-5.1.6.js";
async function invoke(
  label,
  source,
  { dependencies = [], failure = null } = {},
) {
  const native = await dockerContainer();
  const row = { name: native.name, label, created: false, cleaned: false };
  record.containers.push(row);
  await save();
  const container = new LocalNodeProbe(native),
    controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  let ready = false;
  try {
    container.start(randomUUID());
    row.created = true;
    await save();
    await container.ready(
      () => controller.signal.throwIfAborted(),
      controller.signal,
    );
    ready = true;
    const reply = await container.execute(
      {
        entrypoint: "src/main.mjs",
        files: [{ path: "src/main.mjs", content: source }],
        dependencies,
      },
      {
        operation: "probe",
        input: {},
        state: { retained: "outside guest" },
        now: 0,
      },
      () => controller.signal.throwIfAborted(),
      controller.signal,
    );
    assert.equal(failure, null, `${label} unexpectedly succeeded`);
    record.checks.push({ label, outcome: "reply" });
    return reply;
  } catch (error) {
    if (!failure || !ready || error instanceof assert.AssertionError)
      throw error;
    assert.equal(
      failure === "timeout" ? error.status === 504 : error.code === failure,
      true,
      `${label}: unexpected ${error.message}`,
    );
    record.checks.push({
      label,
      outcome: "rejected",
      code: error.code ?? error.status ?? error.name,
    });
  } finally {
    clearTimeout(timer);
    await container.destroy();
    row.cleaned = true;
    await save();
  }
}
try {
  const first = await invoke(
    "Node built-ins and exact locked library",
    `import {customAlphabet} from 'nanoid';
import {writeFileSync} from 'node:fs';
export function execute({state}){writeFileSync('/tmp/earlier-request','private');return {result:{version:process.versions.node,id:customAlphabet('r',4)()},state};}`,
    { dependencies: [dependency] },
  );
  assert.equal(first.result.version, NODE_RUNTIME.nodeVersion);
  assert.equal(first.result.id, "rrrr");
  assert.deepEqual(first.state, { retained: "outside guest" });
  const second = await invoke(
    "Fresh filesystem after destruction",
    `import {existsSync} from 'node:fs';export function execute({state}){return {result:existsSync('/tmp/earlier-request'),state};}`,
  );
  assert.equal(second.result, false);
  const network = await invoke(
    "No guest Internet",
    `export async function execute({state}){try{await fetch('https://example.com',{signal:AbortSignal.timeout(300)});return {result:'escaped',state};}catch{return {result:'denied',state};}}`,
  );
  assert.equal(network.result, "denied");
  await invoke(
    "Infinite loop bounded by outside deadline",
    `export function execute(){for(;;){}}`,
    { failure: "timeout" },
  );
  await invoke(
    "Excess output rejected",
    `export function execute({state}){return {result:'x'.repeat(100000),state};}`,
    { failure: "output_limit" },
  );
  const child = await invoke(
    "Spawned descendants removed with guest",
    `import {spawn} from 'node:child_process';export function execute({state}){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();return {result:'spawned',state};}`,
  );
  assert.equal(child.result, "spawned");
  record.completedAt = new Date().toISOString();
  await save();
  console.log(
    `Local pinned Node proof passed; ${record.containers.length} owned containers verified removed. Journal: ${directory}/report.json`,
  );
} catch (error) {
  await save();
  console.error(`Node proof journal: ${directory}/report.json`);
  throw error;
}
