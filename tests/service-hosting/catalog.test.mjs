import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { create } from "../assistant-tasks/fixtures.mjs";
import { checkedFixture } from "./fixtures.mjs";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";

test("owner catalog enforces service/daily/release caps and immutable ownership before any provider effect", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {DurableObject} from 'cloudflare:workers';
    import {ServiceCatalog} from './server/cloud-services/catalog.js';
    export class Catalog extends DurableObject {
      constructor(ctx,env){super(ctx,env);this.catalog=new ServiceCatalog(ctx.storage.sql);}
      run(value){return this.ctx.storage.transactionSync(()=>{
        const c=this.catalog;
        if(value.action==='observe'){c.observe(value.identity,value.state,value.now);return c.services();}
        return c.intent(value.task,value.publication,value.now);
      });}
    }
    export default {async fetch(request,env){try{return Response.json(await env.CATALOG.getByName('owner').run(await request.json()));}
      catch(error){return Response.json({error:'rejected'},{status:error.status??409});}}};
  `,
    },
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "catalog-tests",
      modules,
      compatibilityDate: "2026-10-03",
      durableObjects: { CATALOG: { className: "Catalog", useSQLite: true } },
    }),
  );
  const call = async (value) => {
    const response = await mf.dispatchFetch("https://catalog.test", {
      method: "POST",
      body: JSON.stringify(value),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const checked = await checkedFixture(),
      task = create(),
      now = task.deadlineAt - 1000,
      publications = [];
    for (let i = 0; i < 4; i++) {
      const publication = await prepareServicePublication(
        task,
        `release-${i}`,
        checked,
      );
      publications.push(publication);
      assert.equal((await call({ task, publication, now })).status, 200);
    }
    assert.equal(
      (await call({ task, publication: publications[0], now })).status,
      200,
      "Exact replay still works at the release cap",
    );
    assert.equal(
      (
        await call({
          task,
          publication: await prepareServicePublication(
            task,
            "release-4",
            checked,
          ),
          now,
        })
      ).status,
      429,
    );
    const changed = await prepareServicePublication(
      task,
      "release-0",
      await checkedFixture(
        "export function execute(){return {result:null,state:null};}",
      ),
    );
    assert.equal((await call({ task, publication: changed, now })).status, 409);
    assert.equal(
      (
        await call({
          task: { ...task, ownerId: "other" },
          publication: publications[0],
          now,
        })
      ).status,
      409,
    );
    for (let i = 1; i < 8; i++) {
      const next = { ...task, id: `task-${i}` };
      assert.equal(
        (
          await call({
            task: next,
            publication: await prepareServicePublication(
              next,
              "release",
              checked,
            ),
            now,
          })
        ).status,
        200,
      );
    }
    const ninth = { ...task, id: "ninth" };
    assert.equal(
      (
        await call({
          task: ninth,
          publication: await prepareServicePublication(
            ninth,
            "release",
            checked,
          ),
          now,
        })
      ).status,
      429,
    );
    for (const publication of publications)
      await call({
        action: "observe",
        identity: publication.identity,
        state: "deleted",
        now: task.deadlineAt,
      });
    const fresh = createTask(ninth.input, {
      id: ninth.id,
      ownerId: ninth.ownerId,
      now: task.deadlineAt,
      inputDigest: ninth.creationDigest,
    });
    assert.equal(
      (
        await call({
          task: fresh,
          publication: await prepareServicePublication(
            fresh,
            "release",
            checked,
          ),
          now: task.deadlineAt,
        })
      ).status,
      429,
      "Deleting a service cannot reset the daily creation budget",
    );
  } finally {
    await mf.dispose();
  }
});
