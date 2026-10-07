import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";
import { exerciseNode } from "./exercise.mjs";
import {
  NODE_LIMITS,
  NODE_RUNTIME,
} from "../../../server/cloud-services/node/runtime.js";

const [accountId, mode, journal] = process.argv.slice(2);
assert.match(accountId ?? "", /^[a-f0-9]{32}$/);
assert.ok(
  ["--dry-run", "--run-approved-node-proof", "--cleanup"].includes(mode),
  "Choose dry run, explicitly approved run, or cleanup only",
);
if (mode === "--cleanup")
  assert.ok(journal, "Cleanup requires the recorded report.json");
const resources = await prepareResources(accountId, {
  resumeReport: mode === "--cleanup" ? journal : null,
});
console.log(`Node proof journal: ${resources.reportFile}`);
try {
  if (mode !== "--cleanup") {
    const expiresAt = Date.now() + 60 * 60_000;
    resources.report.plan = {
      scope: "Node runtime proof only; no production routes/model calls",
      expiresAt,
      maxStarts: 100,
      maxInstances: 2,
      concurrencyControl:
        "two fixed private Durable Object slots; native DO-managed applications do not accept max_instances",
      leaseMs: NODE_LIMITS.leaseMs,
      estimateUsd: 1,
      runtime: NODE_RUNTIME,
      approved: mode === "--run-approved-node-proof",
    };
    await resources.save();
    const className = `RestyleNode${resources.id}`;
    const entrypoint = resolve(resources.directory, "node-worker.js");
    const module = resolve("scripts/checks/node-runtime/worker.js");
    await writeFile(
      entrypoint,
      `export { default } from ${JSON.stringify(module)};\nexport { ProofExecution as ${className} } from ${JSON.stringify(module)};\n`,
      { mode: 0o600 },
    );
    const resource = await resources.prepare("workspace", {
      entrypoint,
      expiresAt,
      containerClassName: className,
      bindings: [{ name: "NODE_EXECUTION", class_name: className }],
      containerImages: {
        runtime: {
          dockerfile: resolve("server/cloud-services/node/guest/Dockerfile"),
          build_context: resolve("server/cloud-services/node/guest"),
        },
      },
    });
    if (mode === "--dry-run") {
      await resources.dryRun(resource);
      resources.report.dryRunPassed = true;
      await resources.save();
    } else {
      await resources.deploy(resource);
      await resources.ready(resource);
      const denied = await resources.call(
        resource,
        "/status",
        "GET",
        undefined,
        false,
      );
      assert.equal(denied.status, 401);
      await exerciseNode(
        async (label, source, { dependencies = [], failure = null } = {}) => {
          const id = randomUUID(),
            startedAt = Date.now();
          assert.ok(
            startedAt < expiresAt - NODE_LIMITS.leaseMs,
            "Proof deadline reached",
          );
          const row = { id, label, startedAt, status: "pending" };
          resources.report.checks.push(row);
          await resources.save();
          const result = await resources.call(resource, "/execute", "POST", {
            id,
            ownerId: "proof-owner",
            serviceId: "proof-service",
            mode: "probe",
            expiresAt: startedAt + NODE_LIMITS.leaseMs,
            bundle: {
              entrypoint: "src/main.mjs",
              files: [{ path: "src/main.mjs", content: source }],
              dependencies,
            },
            invocation: {
              operation: "probe",
              input: {},
              state: { retained: "outside guest" },
              now: 0,
            },
          });
          assert.equal(result.status, 200);
          assert.equal(result.marker, resources.id);
          if (failure) {
            assert.equal(result.data.ok, false);
            assert.equal(result.data.code, failure);
          } else
            assert.equal(result.data.ok, true, JSON.stringify(result.data));
          const state = await resources.call(resource, "/status");
          assert.equal(state.data.lease, null);
          assert.equal(state.data.running, false);
          assert.equal(state.data.instance, null);
          row.status = "passed";
          row.durationMs = Date.now() - startedAt;
          row.usage = state.data.usage;
          await resources.save();
          return result.data.value;
        },
      );
      resources.report.runtimeProofPassed = true;
      await resources.save();
    }
  }
} finally {
  await resources.cleanup();
  assert.equal(
    resources.report.cleanupVerified,
    true,
    `Cleanup pending: ${resources.reportFile}`,
  );
}
