import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";

export const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
let modules;
export async function fixture(effect = async () => Response.json({})) {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { ServiceNodeExecution } from './server/cloud-services/node/coordinator.js';
    export class TestExecution extends ServiceNodeExecution {
      now(){return this.clock??Date.now();}
      setTime(now){this.clock=now;}
      containerAdapter(){const effect=async kind=>{const reply=await (await this.env.EFFECTS.fetch('https://effect.test',{method:'POST',body:JSON.stringify({kind})})).json();if(reply.fail)throw new Error('Controlled missing receipt');return reply;};return {
        start:()=>effect('start'), ready:async check=>{check();},
        execute:()=>effect('execute'),destroy:()=>effect('destroy'),
      };}
      limits(){return {owner:2,platform:4};}
      sweep(){return this.alarm();}
      async diagnostic(){return {lease:this.lease(),usage:this.ctx.storage.sql.exec('SELECT * FROM node_usage').toArray(),receipts:this.ctx.storage.sql.exec('SELECT * FROM node_receipts').toArray(),alarm:await this.ctx.storage.getAlarm()};}
    }
    export default {async fetch(request,env){const {kind,...input}=await request.json();const stub=env.RUNTIME.getByName('slot-0');
      if(kind==='execute')return Response.json(await stub.execute(input));
      if(kind==='cancel')return Response.json(await stub.cancel(input.id));
      if(kind==='time'){await stub.setTime(input.now);return Response.json({});}
      if(kind==='usage')return Response.json(await stub.usage(input.ownerId,input.serviceId));
      if(kind==='cleanup'){await stub.sweep();return Response.json(await stub.diagnostic());}
      return Response.json(await stub.diagnostic());
    }};`,
    },
  });
  const root = await mkdtemp(join(tmpdir(), "restyle-node-state-"));
  let mf;
  const start = async () => {
    mf = new Miniflare(
      await convertV4MiniflareOptions({
        modules: await modules,
        compatibilityDate: "2026-10-03",
        durableObjects: {
          RUNTIME: { className: "TestExecution", useSQLite: true },
        },
        serviceBindings: { EFFECTS: effect },
        isolatedResourcePersistencePath: root,
        resourcePersistencePath: root,
      }),
    );
  };
  await start();
  return {
    call: async (body) =>
      (
        await mf.dispatchFetch("https://test/", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json(),
    restart: async () => {
      await mf.dispose();
      await start();
    },
    close: async () => {
      await mf.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
export const request = (id, ownerId = "creator") => ({
  kind: "execute",
  id,
  ownerId,
  serviceId: "service-one",
  mode: "test",
  expiresAt: Date.now() + 10000,
  bundle: {
    entrypoint: "src/main.mjs",
    files: [
      {
        path: "src/main.mjs",
        content: "export function execute(){return null}",
      },
    ],
    dependencies: [],
  },
  invocation: {},
});
