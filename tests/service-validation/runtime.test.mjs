import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { fixtureNodeEffect } from "../node-runtime/fixture.mjs";
import { supportedNodeLibraries } from "../../packages/pvo-assistant/services/index.js";
import {
  packageFor,
  dinnerAgreement,
  equipmentAgreement,
  dinnerSource,
  equipmentSource,
} from "./fixtures.mjs";
let modules;
async function fixture() {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { FixtureNodeExecution } from "./tests/node-runtime/fixture-worker.js";
    import {executeServicePackage} from './server/cloud-services/packageExecution.js';
    import {runServiceStep} from './server/assistant/validation/cases.js';
    export default {async fetch(request,env) {
      const value=await request.json();
      try {
        let result;
        if(value.agreement) {
          let cursor={step:0,state:value.agreement.cases[0].initialState};
          for(;;) {
            const observation=await runServiceStep(env.SERVICE_NODE_EXECUTION,value.source,value.agreement,value.source.agreementDigest,0,cursor,{ownerId:"owner",serviceId:"service",mode:"validation"},request.signal);
            if(observation.caseResult){result=observation.caseResult;break;}
            cursor={step:cursor.step+1,state:observation.state};
          }
        } else result=await executeServicePackage(env.SERVICE_NODE_EXECUTION,value.source,value.input,{ownerId:"owner",serviceId:"service",mode:"test"},request.signal);
        return Response.json(result);
      } catch(error) {return Response.json({error:error.code ?? 'rejected'},{status:409});}
    }};`,
    },
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "trusted-service-test",
      modules: await modules,
      compatibilityDate: "2026-10-03",
      durableObjects: {
        SERVICE_NODE_EXECUTION: {
          className: "FixtureNodeExecution",
          useSQLite: true,
        },
      },
      serviceBindings: { NODE_FIXTURE: fixtureNodeEffect },
      bindings: { PLATFORM_SECRET: "must-never-reach-generated-code" },
    }),
  );
  await mf.ready;
  return {
    call: async (value) => {
      const response = await mf.dispatchFetch("https://validation.test", {
        method: "POST",
        body: JSON.stringify(value),
      });
      return { status: response.status, body: await response.json() };
    },
    close: () => mf.dispose(),
  };
}

test(
  "Node fixtures pass both saved behavior agreements through actual worker RPC without running generated tests",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      for (const [agreement, source] of [
        [dinnerAgreement(), dinnerSource],
        [equipmentAgreement(), equipmentSource],
      ]) {
        const pkg = packageFor("export { execute } from './rules.mjs';");
        pkg.files.push({ path: "src/rules.mjs", content: source });
        const result = await f.call({ source: pkg, agreement });
        assert.equal(result.status, 200);
        assert.equal(result.body.status, "passed", JSON.stringify(result.body));
        assert.equal(
          result.body.completedSteps,
          agreement.cases[0].steps.length,
        );
      }
    } finally {
      await f.close();
    }
  },
);

test(
  "Node integration rejects wrong behavior, forged pass claims, invalid imports and excess output",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      for (const [source, code] of [
        [
          "export function execute({state}) {return {result:'full',state};}",
          "mismatch",
        ],
        ["export function execute() {return {passed:true};}", "invalid_reply"],
        [
          "import 'unlocked-package'; export function execute(){return {};}",
          "execution_failed",
        ],
        [
          "import '../tests/service.test.mjs'; export function execute(){return {};}",
          "execution_failed",
        ],
        [
          "export function execute(){return {result:'x'.repeat(70000),state:null};}",
          "output_limit",
        ],
      ]) {
        const result = await f.call({
          source: packageFor(source),
          agreement: dinnerAgreement(),
        });
        assert.equal(result.body.status, "failed", JSON.stringify(result.body));
        assert.equal(result.body.failure.code, code, source);
      }
    } finally {
      await f.close();
    }
  },
);

test("Node built-ins and exact retained libraries run in fresh fixture processes without platform credentials", async () => {
  const f = await fixture();
  try {
    const source =
      packageFor(`import {createHash} from 'node:crypto'; import {customAlphabet} from 'nanoid'; let count=0;
      export function execute({state}) { return {result:{hash:createHash('sha256').update('restyle').digest('hex'),id:customAlphabet('r',4)(),count:++count,secret:process.env.PLATFORM_SECRET ?? null},state}; }`);
    source.dependencies = supportedNodeLibraries();
    for (let i = 0; i < 2; i++) {
      const result = await f.call({ source, input: { state: null } });
      assert.equal(result.status, 200);
      assert.equal(result.body.result.id, "rrrr");
      assert.match(result.body.result.hash, /^[a-f0-9]{64}$/);
      assert.equal(result.body.result.count, 1);
      assert.equal(result.body.result.secret, null);
    }
  } finally {
    await f.close();
  }
});
