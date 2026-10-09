import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { exerciseWorkspaces } from "../../scripts/checks/cloud-agent-workspaces/exercise.mjs";

test("deployable workspace diagnostic controls pass real workerd storage/RPC with simulated computers", async () => {
  const modules = await bundleWorkerModules({
    entryPoints: ["tests/assistant-workspaces/proof-worker.js"],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "workspace-diagnostic",
      modules,
      compatibilityDate: "2026-10-03",
      durableObjects: {
        ASSISTANT_WORKSPACES: {
          className: "ControlledWorkspaceProof",
          useSQLite: true,
        },
        WORKSPACE_BUDGET: {
          className: "WorkspaceProofBudget",
          useSQLite: true,
        },
      },
      bindings: {
        PROOF_ID: "local-diagnostic",
        PROOF_TOKEN: "local-private-only",
        PROOF_EXPIRES_AT: String(Date.now() + 1200000),
      },
    }),
  );
  const call = async (path, method = "GET", authenticated = true) => {
    const response = await mf.dispatchFetch(`https://proof.example${path}`, {
      method,
      headers: authenticated
        ? { Authorization: "Bearer local-private-only" }
        : {},
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  };
  try {
    await exerciseWorkspaces(call);
    const cleanup = await call("/", "DELETE");
    assert.equal(cleanup.status, 200);
    assert.equal(
      cleanup.data.results.every((result) => result.absent),
      true,
    );
  } finally {
    await mf.dispose();
  }
});
