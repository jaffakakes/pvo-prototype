import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { checkFlyNetwork } from "./network.mjs";
import { NODE_RUNTIME } from "../../../../server/cloud-services/node/runtime.js";

/** Fixed probe runs separately from Fly's shorter synchronous exec request lifetime. */
export async function checkGvisor(machine) {
  await checkFlyNetwork(machine, true);
  await machine.command([
    "node",
    "--input-type=module",
    "-e",
    `import {spawn} from 'node:child_process';
     const child=spawn(process.execPath,['--input-type=module','-e',
       "import {writeFileSync,renameSync} from 'node:fs';try{await import('/runtime/gvisor-guest.mjs')}catch(error){writeFileSync('/runtime/sandbox-status.next',JSON.stringify({phase:'failed',message:String(error.message).slice(0,1000),stderr:String(error.stderr??'').slice(0,2000)}));renameSync('/runtime/sandbox-status.next','/runtime/sandbox-status.json')}"
     ],{detached:true,stdio:'ignore'});child.unref();process.stdout.write('{}');`,
  ]);
  const deadline = Date.now() + 105000;
  while (Date.now() < deadline) {
    let status;
    try {
      status = JSON.parse(
        await machine.command(
          [
            "node",
            "--input-type=module",
            "-e",
            `import {readFileSync,existsSync} from 'node:fs';const path='/runtime/sandbox-status.json';process.stdout.write(existsSync(path)?readFileSync(path,'utf8'):'{"phase":"starting"}');`,
          ],
          { timeoutMs: Math.min(8000, deadline - Date.now()) },
        ),
      );
    } catch (error) {
      if (
        !["TimeoutError", "AbortError"].includes(error.name) &&
        !(error.name === "TypeError" && error.message === "fetch failed")
      )
        throw error;
      continue;
    }
    machine.resources.report.sandboxStatus = status;
    await machine.resources.save();
    if (status.phase === "failed")
      throw new Error("Fixed sandbox probe failed; see private stage receipt");
    if (status.phase === "passed") {
      const result = status.result;
      assert.equal(result.actual.nodeVersion, NODE_RUNTIME.nodeVersion);
      assert.equal(result.actual.uid, 1000);
      assert.equal(result.actual.childUid, "1000");
      assert.equal(result.actual.gainedRoot, false);
      assert.deepEqual(result.actual.network, [false, false, false, false]);
      assert.deepEqual(result.actual.hostFiles, []);
      const fields = Object.fromEntries(
        result.actual.status.map((line) => line.split(/:\s*/)),
      );
      for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
        assert.equal(fields[field], "0000000000000000");
      assert.equal(fields.NoNewPrivs, "1");
      return result;
    }
    await delay(2000);
  }
  throw new Error("Fixed sandbox probe exceeded its outside-guest deadline");
}
