import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function transport(events) {
  // Exercise the actual transport when process exit precedes pipe closure, as Node permits.
  const bootstrap = `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
fs.writeFileSync=()=>{};
childProcess.spawn=()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>true;
 setTimeout(()=>{${events}},10);return child;
};
syncBuiltinESMExports();`;
  const input = Buffer.from(JSON.stringify({ path: "/ready" })).toString(
    "base64",
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "data:text/javascript," + encodeURIComponent(bootstrap),
      new URL(
        "../../server/cloud-services/node/guest/transport.mjs",
        import.meta.url,
      ).pathname,
      input,
    ],
    { timeout: 5000, maxBuffer: 512 * 1024 },
  );
  return JSON.parse(stdout);
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
