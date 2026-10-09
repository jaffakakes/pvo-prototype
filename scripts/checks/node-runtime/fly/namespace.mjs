import assert from "node:assert/strict";
import { networkProbeProgram, checkFlyNetwork } from "./network.mjs";

// Fixed capability investigation, not a complete product sandbox or generated-service executor.
const program =
  networkProbeProgram +
  String.raw`
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let gainedRoot = false;
try { process.setuid(0); gainedRoot = process.getuid() === 0; } catch {}
const status = readFileSync('/proc/self/status','utf8').split('\n').filter(line => /^(Cap|NoNewPrivs)/.test(line));
const child = spawnSync(process.execPath,['-e','process.stdout.write(String(process.getuid()))'],{encoding:'utf8',timeout:1000});
const enter = spawnSync('/usr/bin/nsenter',['--net=/proc/1/ns/net','true'],{encoding:'utf8',timeout:1000});
process.stdout.write(JSON.stringify({network,uid:process.getuid(),gid:process.getgid(),gainedRoot,status,childUid:child.stdout,enterExit:enter.status}));
`;

export async function checkLinuxIsolation(machine) {
  await checkFlyNetwork(machine, true);
  const raw = await machine.command(
    [
      "/usr/bin/unshare",
      "--mount",
      "--pid",
      "--net",
      "--ipc",
      "--fork",
      "--kill-child",
      "--mount-proc",
      "/usr/bin/setpriv",
      "--reuid",
      "1000",
      "--regid",
      "1000",
      "--clear-groups",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--no-new-privs",
      "/usr/local/bin/node",
      "--input-type=module",
      "-e",
      program,
    ],
    { timeoutMs: 6000 },
  );
  const actual = JSON.parse(raw);
  assert.deepEqual(actual.network, {
    tcp4: false,
    tcp6: false,
    udp4: false,
    udp6: false,
  });
  assert.equal(actual.uid, 1000);
  assert.equal(actual.gid, 1000);
  assert.equal(actual.childUid, "1000");
  assert.equal(actual.gainedRoot, false);
  assert.equal(actual.enterExit, 1);
  const fields = Object.fromEntries(
    actual.status.map((line) => line.split(/:\s*/)),
  );
  for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(fields[field], "0000000000000000");
  assert.equal(fields.NoNewPrivs, "1");
  return actual;
}
