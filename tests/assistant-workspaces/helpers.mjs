import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { workspaceResourceId } from "../../server/assistant/workspaces/identity.js";

export const NOW = Date.UTC(2100, 0, 1);
export const executionGrant = (generation = 1) => ({
  id: `claim-${generation}`,
  generation,
  expiresAt: NOW + 60_000,
});
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
    export { TestBudget, TestWorkspace } from './tests/assistant-workspaces/controlled-worker.js';
    import { workspaceProvider } from './server/assistant/tasks/workspaceProvider.js';
    export default {async fetch(request,env) {
      const {action,identity,input,now,execution,budget=false,viaProvider=false}=await request.json();
      const stub=budget ? env.WORKSPACE_BUDGET.getByName('global') : env.WORKSPACES.getByName(identity.resourceId);
      try {
        let result;
        if(viaProvider) {
          const provider=workspaceProvider({...env,ASSISTANT_WORKSPACES:env.WORKSPACES});
          if(['save','start','execute'].includes(action)) result=await provider.operate(identity,action==='execute'?'command':action,input,execution);
          else result=await provider[action](identity,input);
        }
        else if(action==='time') result=await stub.setTime(now);
        else if(action==='inspect') result=await stub.inspect();
        else if(action==='alarm') result=await stub.sweep();
        else if(action==='crash') result=await stub.crash();
        else if(budget) result=await stub[action](input);
        else result=await stub[action](identity,input,execution);
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
          body: JSON.stringify({
            action,
            identity,
            input,
            execution: executionGrant(),
            ...extra,
          }),
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
