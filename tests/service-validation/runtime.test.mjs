import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { serviceWorkerCode } from "../../server/assistant/validation/packageExecution.js";
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
    import {executeServicePackage} from './server/assistant/validation/packageExecution.js';
    import {runServiceCase} from './server/assistant/validation/cases.js';
    export default {async fetch(request,env) {
      const value=await request.json();
      try {
        const result=value.agreement
          ? await runServiceCase(env.LOADER,value.source,value.agreement,value.source.agreementDigest,0,request.signal)
          : await executeServicePackage(env.LOADER,value.source,value.input,request.signal);
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
      workerLoaders: { LOADER: {} },
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

test("Worker code includes only explicit source modules and fixed isolation limits", () => {
  const code = serviceWorkerCode(packageFor());
  assert.deepEqual(code.env, {});
  assert.equal(code.globalOutbound, null);
  assert.deepEqual(code.limits, { cpuMs: 50, subRequests: 0 });
  assert.ok(code.modules["src/service.mjs"].js);
  assert.ok(!code.modules["tests/service.test.mjs"]);
  assert.ok(!JSON.stringify(code).includes("must-never-reach"));
});

test(
  "actual isolated multi-module Workers pass both saved behavior agreements without running generated tests",
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
  "actual runtime rejects wrong behavior, forged pass claims, invalid imports and excess output",
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

test(
  "fresh runtime has no shared globals, parent bindings or outbound HTTP access",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    try {
      const source =
        packageFor(`import {env} from 'cloudflare:workers'; import fs from 'node:fs'; let count=0;
      export async function execute({state}) {let blocked=false;try{await fetch('https://example.com');}catch{blocked=true;}
      let privateFilesBlocked=false;try{fs.readFileSync('/etc/passwd','utf8');}catch{privateFilesBlocked=true;}
      return {result:{blocked,privateFilesBlocked,keys:Object.keys(env),count:++count},state};}`);
      for (let i = 0; i < 2; i++) {
        const result = await f.call({ source, input: { state: null } });
        assert.deepEqual(result.body, {
          result: {
            blocked: true,
            privateFilesBlocked: true,
            keys: [],
            count: 1,
          },
          state: null,
        });
      }
    } finally {
      await f.close();
    }
  },
);
