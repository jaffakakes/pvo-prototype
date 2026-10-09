import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { fixtureNodeEffect } from "./fixture.mjs";
import { exerciseConnected } from "../../scripts/checks/connected-services/exercise.mjs";
import { checkProductBrowser } from "../../scripts/checks/node-product/browser.mjs";

test(
  "connected cloud acceptance rehearses independent Node checks, private account calls, restart and revocation",
  { timeout: process.env.RESTYLE_PRODUCT_BROWSER ? 120000 : 60000 },
  async () => {
    const modules = await bundleWorkerModules({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    export { default } from './scripts/checks/node-product/worker.js';
    import { ConnectedTasks } from './scripts/checks/connected-services/tasks.js';
    import { githubAdapter } from './server/connections/providers/github.js';
    export class ProductTasks extends ConnectedTasks { connectionProvider() { return githubAdapter((request) => this.env.GITHUB_FIXTURE.fetch(request)); } }
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
          ACCOUNT_CONNECTION_KEY: "b".repeat(64),
        },
        durableObjects: Object.fromEntries(
          Object.entries({
            ASSISTANT_TASKS: "ProductTasks",
            SERVICE_HOSTS: "ProductHost",
            PROOF_CONTROL: "ProductControl",
            SERVICE_NODE_EXECUTION: "FixtureNodeExecution",
          }).map(([key, className]) => [key, { className, useSQLite: true }]),
        ),
        serviceBindings: {
          NODE_FIXTURE: fixtureNodeEffect,
          GITHUB_FIXTURE: async (request) => {
            assert.equal(request.method, "GET");
            const path = new URL(request.url).pathname;
            return Response.json(
              path === "/user"
                ? { id: 123, login: "jaffakakes" }
                : path.endsWith("/issues")
                  ? []
                  : {
                      full_name: "jaffakakes/pvo-prototype",
                      private: false,
                      open_issues_count: 0,
                    },
            );
          },
        },
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
      await exerciseConnected({
        token: "github_pat_synthetic_connection_key_never_real_123456789",
        call,
        record: async (name, evidence) => checks.push({ name, evidence }),
        ...(process.env.RESTYLE_PRODUCT_BROWSER
          ? {
              browserCheck: (options) =>
                checkProductBrowser({
                  ...options,
                  origin,
                  publicBridge: true,
                  clientClockOffsetMs: -60000,
                }),
            }
          : {}),
      });
      assert.equal(checks.length, process.env.RESTYLE_PRODUCT_BROWSER ? 4 : 3);
    } finally {
      await mf.dispose();
    }
  },
);
