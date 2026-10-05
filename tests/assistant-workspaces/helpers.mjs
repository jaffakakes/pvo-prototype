import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { workspaceResourceId } from "../../server/assistant/workspaces/identity.js";

export const NOW = Date.UTC(2100, 0, 1);
export async function identity(taskId = "task-one", ownerId = "owner-one") {
  const value = {
    ownerId,
    projectId: "project-one",
    taskId,
    deadlineAt: NOW + 86_400_000,
    expiresAt: NOW + 7 * 86_400_000,
  };
  return { ...value, resourceId: await workspaceResourceId(value) };
}
export const files = () => [
  { path: "src/service.mjs", content: "export const execute = () => 42;" },
  { path: "tests/service.test.mjs", content: "import '../src/service.mjs';" },
];
export const command = (reference, id = "test-one") => ({
  id,
  ...reference,
  command: { kind: "test", paths: ["tests/service.test.mjs"] },
});

let modules;
export async function workspaceFixture(
  control = async () => new Response(JSON.stringify({})),
) {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { AssistantWorkspace } from './server/assistant/workspaces/coordinator.js';
    import { WorkspaceBudget } from './server/assistant/workspaces/budget.js';
    export class TestBudget extends WorkspaceBudget {
      now() { return this.clock ?? Date.UTC(2100,0,1); }
      setTime(now) { this.clock=now; }
      async sweep() { await this.alarm(); return true; }
      inspect() { return this.ctx.storage.sql.exec('SELECT body,released FROM workspace_grants').toArray().map(row=>({...JSON.parse(row.body),released:!!row.released})); }
    }
    export class TestWorkspace extends AssistantWorkspace {
      constructor(ctx,env) {
        super(ctx,env);
        ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fake_vm (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
      }
      now() { return this.clock ?? Date.UTC(2100,0,1); }
      setTime(now) { this.clock=now; }
      async sweep() { await this.alarm(); return true; }
      crash() { this.ctx.abort('Controlled workspace restart'); }
      effectTimeoutMs() { return 150; }
      vm() { return JSON.parse(this.ctx.storage.sql.exec('SELECT body FROM fake_vm WHERE id=1').toArray()[0]?.body ?? '{"running":false,"starts":0,"destroys":0,"executions":0}'); }
      saveVM(vm) { this.ctx.storage.sql.exec('INSERT INTO fake_vm (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',JSON.stringify(vm)); }
      provider() {
        const control=async kind=>{
          const result=await (await this.env.CONTROL.fetch('https://control.test/',{method:'POST',body:JSON.stringify({kind,resourceId:this.journal.state()?.identity.resourceId})})).json();
          if(result.fail) throw new Error('Controlled provider failure');
          return result;
        };
        return {
          absent: async()=>!this.vm().running,
          start: ()=>{const vm=this.vm(); if(vm.running) throw new Error('Duplicate VM'); this.saveVM({...vm,running:true,starts:vm.starts+1,files:null});},
          restore: async (snapshot,assertCurrent)=>{await control('restore');assertCurrent();const vm=this.vm();if(!vm.running)throw new Error('VM stopped');this.saveVM({...vm,files:snapshot.files});},
          execute: async()=>{const vm=this.vm();if(!vm.running)throw new Error('VM stopped');this.saveVM({...vm,executions:vm.executions+1});const result=await control('execute');return {stdout:result.stdout??'ok',stderr:'',exitCode:result.exitCode??0};},
          destroy: async()=>{await control('destroy');const vm=this.vm();this.saveVM({...vm,running:false,destroys:vm.destroys+1,files:null});},
        };
      }
      inspect() { return {state:this.journal.state(),vm:this.vm(),actions:this.ctx.storage.sql.exec('SELECT body FROM workspace_actions').toArray().map(row=>JSON.parse(row.body))}; }
    }
    export default {async fetch(request,env) {
      const {action,identity,input,now,budget=false}=await request.json();
      const stub=budget ? env.WORKSPACE_BUDGET.getByName('global') : env.WORKSPACES.getByName(identity.resourceId);
      try {
        let result;
        if(action==='time') result=await stub.setTime(now);
        else if(action==='inspect') result=await stub.inspect();
        else if(action==='alarm') result=await stub.sweep();
        else if(action==='crash') result=await stub.crash();
        else if(budget) result=await stub[action](input);
        else result=await stub[action](identity,input);
        return Response.json({result:result??null});
      } catch(error) {return Response.json({error:error.message},{status:409});}
    }};
  `,
    },
  });
  const persist = await mkdtemp(join(tmpdir(), "restyle-workspaces-test-"));
  const bundled = await modules;
  const options = convertV4MiniflareOptions({
    name: "workspace-test",
    modules: bundled,
    compatibilityDate: "2026-09-27",
    durableObjects: {
      WORKSPACES: { className: "TestWorkspace", useSQLite: true },
      WORKSPACE_BUDGET: { className: "TestBudget", useSQLite: true },
    },
    serviceBindings: { CONTROL: control },
    isolatedResourcePersistencePath: persist,
    resourcePersistencePath: persist,
  });
  let mf;
  const start = async () => {
    mf = new Miniflare(options);
    await mf.ready;
  };
  try {
    await start();
    return {
      async call(action, identity, input, extra = {}) {
        const response = await mf.dispatchFetch("https://workspaces.test", {
          method: "POST",
          body: JSON.stringify({ action, identity, input, ...extra }),
        });
        return { status: response.status, ...(await response.json()) };
      },
      async restart() {
        await mf.dispose();
        await start();
      },
      async close() {
        try {
          await mf.dispose();
        } finally {
          await rm(persist, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await mf?.dispose();
    await rm(persist, { recursive: true, force: true });
    throw error;
  }
}
