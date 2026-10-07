import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareFlyInput } from "../../scripts/checks/node-runtime/fly/input.mjs";

async function transport(events, body = null, corrupt = false) {
  const directory = await mkdtemp(join(tmpdir(), "restyle-transport-"));
  if (body !== null) {
    const delivery = prepareFlyInput(body);
    await mkdir(join(directory, "invocation"));
    await writeFile(
      join(directory, "invocation.json"),
      Buffer.from(delivery.files[0].raw_value, "base64"),
    );
    for (const [index, part] of delivery.parts.entries())
      await writeFile(
        join(directory, "invocation", String(index).padStart(3, "0")),
        corrupt && index === 0 ? Buffer.alloc(part.length) : part,
      );
  }
  // Exercise the actual transport when process exit precedes pipe closure, as Node permits.
  const bootstrap = `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
fs.writeFileSync=()=>{};
const originalRead=fs.readFileSync, originalStat=fs.statSync;
const body=originalRead(0,"utf8")||null;
const mapped=path=>typeof path==='string'&&path.startsWith('/control/')?${JSON.stringify(directory)}+path.slice('/control'.length):path;
fs.readFileSync=(path,...args)=>originalRead(mapped(path),...args);
fs.statSync=(path,...args)=>originalStat(mapped(path),...args);
childProcess.spawn=(program,argumentsForSpawn)=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>true;
 setTimeout(()=>{${events}},10);return child;
};
syncBuiltinESMExports();`;
  const running = promisify(execFile)(
    process.execPath,
    [
      "--import",
      "data:text/javascript," + encodeURIComponent(bootstrap),
      new URL(
        "../../server/cloud-services/node/guest/transport.mjs",
        import.meta.url,
      ).pathname,
      body === null ? "--ready" : "--execute",
    ],
    { timeout: 5000, maxBuffer: 512 * 1024 },
  );
  running.child.stdin.end(body ?? "");
  try {
    const { stdout } = await running;
    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("host transport drains the reply pipe after child exit before interpreting it", async () => {
  assert.deepEqual(
    await transport(`
child.emit('exit',0,null);
setTimeout(()=>{child.stdout.emit('data',Buffer.from('{"status":200,"body":"ready"}'));child.emit('close',0,null);},10);`),
    { status: 200, body: "ready" },
  );
});

test("host transport rejects an incomplete reply and an unsuccessful child", async () => {
  assert.deepEqual(
    await transport(
      `child.stdout.emit('data',Buffer.from('{'));child.emit('exit',0,null);child.emit('close',0,null);`,
    ),
    { status: 422, body: "" },
  );
  assert.deepEqual(
    await transport(
      `child.emit('exit',null,'SIGKILL');child.emit('close',null,'SIGKILL');`,
    ),
    { status: 503, body: "" },
  );
});

test("host transport preserves a maximum-size reply containing JSON escapes", async () => {
  const reply = await transport(
    `child.stdout.emit('data',Buffer.from(JSON.stringify({status:200,body:'\\u0000'.repeat(65536)})));child.emit('exit',0,null);child.emit('close',0,null);`,
  );
  assert.equal(reply.status, 200);
  assert.equal(Buffer.byteLength(reply.body), 65536);
});

test("host transport loads the large saved invocation without putting it in the provider command", async () => {
  const body = JSON.stringify({
    literal: "日本語 '';$(not-a-command)".repeat(15000),
  });
  const reply = await transport(
    `const start=argumentsForSpawn.indexOf('/runtime/bridge.mjs')+1; const actual=Buffer.from(argumentsForSpawn.slice(start+1).join(''),'base64').toString('utf8'); if(argumentsForSpawn[start]!=='--execute'||actual!==body) throw new Error('Payload changed'); child.stdout.emit('data',Buffer.from('{"status":200,"body":"delivered"}')); child.emit('close',0,null);`,
    body,
  );
  assert.deepEqual(reply, { status: 200, body: "delivered" });
});

test("host transport rejects a changed input part before spawning generated execution", async () => {
  await assert.rejects(
    transport(
      "throw new Error('Must not spawn');",
      JSON.stringify({ text: "checked bytes" }),
      true,
    ),
    { code: 2 },
  );
});

test("an admitted heavily escaped body remains below the local argument byte ceiling", async () => {
  const body = JSON.stringify({ source: "\\".repeat(500000) });
  const reply = await transport(
    `const start=argumentsForSpawn.indexOf('/runtime/bridge.mjs')+1; if(argumentsForSpawn.reduce((sum,value)=>sum+Buffer.byteLength(value)+1,0)>1600*1024) throw new Error('Argument ceiling'); const actual=Buffer.from(argumentsForSpawn.slice(start+1).join(''),'base64').toString('utf8'); if(actual!==body) throw new Error('Escaped payload changed'); child.stdout.emit('data',Buffer.from('{"status":200,"body":"delivered"}')); child.emit('close',0,null);`,
    body,
  );
  assert.deepEqual(reply, { status: 200, body: "delivered" });
});
