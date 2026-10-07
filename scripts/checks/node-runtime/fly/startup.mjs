/** Fixed startup observation only; no service source or credential is read. */
export async function inspectRuntimeStartup(machine) {
  const program = `
import {spawnSync} from 'node:child_process';
import {sandboxFlags} from '/runtime/sandbox.mjs';
const run = args => {const r=spawnSync('/opt/gvisor/runsc',[...sandboxFlags,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});return {status:r.status,error:r.error?.code,stdout:r.stdout?.slice(0,8192),stderr:r.stderr?.slice(0,4096)};};
const status=run(['state','service']);
const node=run(['exec','--user=1000:1000','service','/usr/local/bin/node','-e','process.stdout.write(JSON.stringify({version:process.versions.node,uid:process.getuid(),cwd:process.cwd()}))']);
process.stdout.write(JSON.stringify({status,node}));
`;
  try {
    return JSON.parse(
      await machine.command(["node", "--input-type=module", "-e", program], {
        timeoutMs: 15000,
      }),
    );
  } catch (error) {
    return { inspectionFailed: error.code ?? error.name };
  }
}
