/** Fixed startup observation only; no service source or credential is read. */
export async function inspectRuntimeStartup(machine) {
  const observation = {};
  try {
    const response = await machine.resources.request("GET", machine.path);
    observation.machine = {
      status: response.status,
      state: response.data?.state,
      events: response.data?.events?.map((event) => ({
        type: event.type,
        status: event.status,
        exit: event.request?.exit_event,
      })),
    };
  } catch (error) {
    observation.machine = { error: String(error.message).slice(0, 200) };
  }
  const program = `
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {sandboxFlags} from '/runtime/sandbox.mjs';
const run = args => {const r=spawnSync('/opt/gvisor/runsc',[...sandboxFlags,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});return {status:r.status,error:r.error?.code,stdout:r.stdout?.slice(0,8192),stderr:r.stderr?.slice(0,4096)};};
const status=run(['state','service']);
const node=run(['exec','--user=1000:1000','service','/usr/local/bin/node','-e','process.stdout.write(JSON.stringify({version:process.versions.node,uid:process.getuid(),cwd:process.cwd()}))']);
const transport=existsSync('/control/transport-status.json')?JSON.parse(readFileSync('/control/transport-status.json','utf8')):null;
const memory=readFileSync('/proc/meminfo','utf8').split('\\n').filter(line=>/^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree):/.test(line));
const dmesg=spawnSync('/bin/dmesg',[],{encoding:'utf8',timeout:2000,maxBuffer:1024*1024});
const oom=(dmesg.stdout??'').split('\\n').filter(line=>/oom-kill|Killed process|Out of memory/.test(line)).slice(-10);
process.stdout.write(JSON.stringify({status,node,transport,memory,oom}));
`;
  try {
    observation.guest = JSON.parse(
      await machine.command(["node", "--input-type=module", "-e", program], {
        timeoutMs: 15000,
      }),
    );
  } catch (error) {
    observation.inspectionFailed = {
      code: error.code ?? error.name,
      message: String(error.message).slice(0, 500),
    };
  }
  return observation;
}
