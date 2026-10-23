import assert from "node:assert/strict";
import nanoid from "../../../packages/pvo-assistant/services/libraries/nanoid-5.1.6.js";
import { NODE_RUNTIME } from "../../../server/cloud-services/node/runtime.js";

/** Expected answers remain in the trusted driver, outside the guest. */
export async function exerciseNode(invoke) {
  const first = await invoke(
    "Pinned Node and locked library",
    `import {customAlphabet} from 'nanoid';import {writeFileSync} from 'node:fs';export function execute({state}){writeFileSync('/tmp/earlier-request','private');return {result:{version:process.versions.node,id:customAlphabet('r',4)()},state};}`,
    { dependencies: [nanoid] },
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
    "Infinite loop stopped outside guest",
    `export function execute(){for(;;){}}`,
    { failure: "timeout" },
  );
  await invoke(
    "Excess output rejected",
    `export function execute({state}){return {result:'x'.repeat(100000),state};}`,
    { failure: "output_limit" },
  );
  const child = await invoke(
    "Descendants removed with guest",
    `import {spawn} from 'node:child_process';export function execute({state}){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();return {result:'spawned',state};}`,
  );
  assert.equal(child.result, "spawned");
}
