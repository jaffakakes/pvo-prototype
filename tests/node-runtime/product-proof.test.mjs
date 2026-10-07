import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { fixtureNodeEffect } from "./fixture.mjs";
import { exerciseProduct } from "../../scripts/checks/node-product/exercise.mjs";
import { checkProductBrowser } from "../../scripts/checks/node-product/browser.mjs";

test("diagnostic admission is durable, globally bounded and closed before cleanup", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { ProductControl } from './scripts/checks/node-product/control.js';
    export default {async fetch(request,env){
      const control=env.PROOF_CONTROL.getByName('global');
      const {action,id}=await request.json();
      return Response.json(action==='close'?await control.close():action==='status'?await control.snapshot():await control.reserve(id));
    }};
  `,
    },
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules,
      compatibilityDate: "2026-10-03",
      bindings: { PROOF_EXPIRES_AT: String(Date.now() + 600000) },
      durableObjects: {
        PROOF_CONTROL: { className: "ProductControl", useSQLite: true },
      },
    }),
  );
  const request = async (body) =>
    (
      await mf.dispatchFetch("https://proof.test", {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).json();
  try {
    const results = await Promise.all(
      Array.from({ length: 34 }, (_, id) =>
        request({ action: "reserve", id: String(id) }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 32);
    assert.equal(await request({ action: "reserve", id: "0" }), false);
    const closed = await request({ action: "close" });
    assert.equal(closed.open, false);
    assert.equal(closed.starts.length, 32);
    assert.equal(await request({ action: "reserve", id: "later" }), false);
    assert.deepEqual(await request({ action: "status" }), closed);
  } finally {
    await mf.dispose();
  }
});

test(
  "prepared product acceptance exercises real Node validation, lost publication, durable records and retention",
  { timeout: process.env.RESTYLE_PRODUCT_BROWSER ? 120000 : 60000 },
  async () => {
    const modules = await bundleWorkerModules({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    export { default } from './scripts/checks/node-product/worker.js';
    export { ProductTasks } from './scripts/checks/node-product/tasks.js';
    export { ProductHost } from './scripts/checks/node-product/host.js';
    export { ProductControl } from './scripts/checks/node-product/control.js';
    export { FixtureNodeExecution } from './tests/node-runtime/fixture-worker.js';
  `,
      },
    });
    const token = "local-preparation-only",
      origin = "https://product-proof.test";
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules,
        compatibilityDate: "2026-10-03",
        bindings: {
          PROOF_ID: "a".repeat(24),
          PROOF_TOKEN: token,
          PROOF_EXPIRES_AT: String(Date.now() + 600000),
          PUBLIC_ORIGIN: origin,
        },
        durableObjects: Object.fromEntries(
          Object.entries({
            ASSISTANT_TASKS: "ProductTasks",
            SERVICE_HOSTS: "ProductHost",
            PROOF_CONTROL: "ProductControl",
            SERVICE_NODE_EXECUTION: "FixtureNodeExecution",
          }).map(([key, className]) => [key, { className, useSQLite: true }]),
        ),
        serviceBindings: { NODE_FIXTURE: fixtureNodeEffect },
      }),
    );
    const checks = [];
    try {
      await mf.ready;
      const call = async (path, method = "GET", body, authenticated = true) => {
        const response = await mf.dispatchFetch(origin + path, {
          method,
          headers: {
            ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          data: response.status === 204 ? null : await response.json(),
        };
      };
      await exerciseProduct({
        call,
        record: async (name, evidence) => checks.push({ name, evidence }),
        ...(process.env.RESTYLE_PRODUCT_BROWSER
          ? {
              browserCheck: (options) =>
                checkProductBrowser({ ...options, origin, publicBridge: true }),
            }
          : {}),
      });
      assert.equal(checks.length, process.env.RESTYLE_PRODUCT_BROWSER ? 7 : 6);
    } finally {
      await mf.dispose();
    }
  },
);
