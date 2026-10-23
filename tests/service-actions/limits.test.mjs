import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import {
  admitServiceUsage,
  HOSTED_SERVICE_LIMITS as limits,
} from "../../packages/pvo-assistant/hosting/index.js";

test("daily admission counts replay calls separately from executions and resets only on the next UTC day", () => {
  const now = 1790000000000,
    day = Math.floor(now / 86400000);
  const exhausted = {
    day,
    calls: limits.dailyCalls,
    executions: limits.dailyExecutions,
  };
  assert.throws(() => admitServiceUsage(exhausted, now, false), {
    code: "budget_exceeded",
  });
  assert.throws(
    () => admitServiceUsage({ ...exhausted, calls: 1 }, now, true),
    { code: "budget_exceeded" },
  );
  assert.deepEqual(admitServiceUsage({ ...exhausted, calls: 1 }, now, false), {
    day,
    calls: 2,
    executions: limits.dailyExecutions,
  });
  assert.deepEqual(admitServiceUsage(exhausted, (day + 1) * 86400000, false), {
    day: day + 1,
    calls: 1,
    executions: 0,
  });
  assert.equal(exhausted.calls, limits.dailyCalls);
});

test("actual SQLite receipt count and byte limits reject a new commit atomically while preserving existing replies", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {ServiceActionStore} from './server/cloud-services/actionStore.js';
    export class Store extends DurableObject {
      constructor(ctx,env){super(ctx,env);this.data=new ServiceActionStore(ctx.storage.sql);}
      exercise(size){
        let failure=null;
        for(let i=0;i<600;i++) {
          const snapshot=this.data.data('live',{count:0});
          const receipt={actionId:'action-'+i,operation:'write',inputDigest:'a'.repeat(64),audience:'public',releaseId:'release',result:'x'.repeat(size),createdAt:1};
          try{this.ctx.storage.transactionSync(()=>this.data.commit('live',snapshot.version,{count:snapshot.state.count+1},receipt));}
          catch(error){failure=error.code;break;}
        }
        return {failure,usage:this.data.usage('live'),snapshot:this.data.data('live',null),first:this.data.receipt('live','action-0')};
      }
    }
    export default {async fetch(request,env){const input=await request.json();return Response.json(await env.STORE.getByName(input.name).exercise(input.size));}};
  `,
    },
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "action-storage-limits",
      modules,
      compatibilityDate: "2026-10-03",
      durableObjects: { STORE: { className: "Store", useSQLite: true } },
    }),
  );
  try {
    const exercise = async (name, size) =>
      await (
        await mf.dispatchFetch("https://storage.test", {
          method: "POST",
          body: JSON.stringify({ name, size }),
        })
      ).json();
    const count = await exercise("count", 0);
    assert.equal(count.failure, "budget_exceeded");
    assert.equal(count.usage.count, limits.receipts);
    assert.equal(count.snapshot.version, limits.receipts);
    assert.equal(count.snapshot.state.count, limits.receipts);
    assert.equal(count.first.actionId, "action-0");
    const bytes = await exercise("bytes", 8192);
    assert.equal(bytes.failure, "budget_exceeded");
    assert.ok(bytes.usage.count < limits.receipts);
    assert.ok(bytes.usage.bytes <= limits.receiptBytes);
    assert.equal(bytes.snapshot.version, bytes.usage.count);
    assert.equal(bytes.snapshot.state.count, bytes.usage.count);
    assert.equal(bytes.first.result.length, 8192);
  } finally {
    await mf.dispose();
  }
});
