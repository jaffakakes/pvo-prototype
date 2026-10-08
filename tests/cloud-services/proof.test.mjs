import { fixtureNodeEffect } from "../node-runtime/fixture.mjs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { exerciseRecovery } from "../../scripts/checks/cloud-agent-recovery/exercise.mjs";

test("the recovery diagnostic exercises production journals and RPC with local Node fixtures", async () => {
  const modules = await bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `export {default,ProofTasks,ProofRelease} from "./scripts/checks/cloud-agent-recovery/proof-worker.js"; export {FixtureNodeExecution} from "./tests/node-runtime/fixture-worker.js";`,
    },
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "recovery-diagnostic",
      modules,
      compatibilityDate: "2026-10-03",
      durableObjects: {
        PROOF_TASKS: { className: "ProofTasks", useSQLite: true },
        SERVICE_NODE_EXECUTION: {
          className: "FixtureNodeExecution",
          useSQLite: true,
        },
        SERVICE_HOSTS: { className: "ProofRelease", useSQLite: true },
      },
      serviceBindings: { NODE_FIXTURE: fixtureNodeEffect },
      bindings: {
        PROOF_ID: "local-diagnostic",
        PROOF_TOKEN: "local-only-private",
        PROOF_EXPIRES_AT: String(Date.now() + 1200000),
      },
    }),
  );
  try {
    await exerciseRecovery(
      async (path, method = "GET", authenticated = true) => {
        const response = await mf.dispatchFetch(
          "https://proof.example" + path,
          {
            method,
            headers: authenticated
              ? { Authorization: "Bearer local-only-private" }
              : {},
          },
        );
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        return { status: response.status, data };
      },
    );
  } finally {
    await mf.dispose();
  }
});
