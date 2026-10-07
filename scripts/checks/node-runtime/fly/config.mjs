import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NODE_RUNTIME } from "../../../../server/cloud-services/node/runtime.js";

export const FLY_PROOF = Object.freeze({
  region: "iad",
  maxMachines: 12,
  lifetimeMs: 60 * 60_000,
  machineLifetimeSeconds: 120,
  memoryMiB: 512,
  maxConcurrent: 1,
  estimateUsd: 1,
});

export async function flyRunnerFiles() {
  const sources = await Promise.all(
    ["files.mjs", "server.mjs"].map(async (path) => ({
      path,
      content: await readFile(
        new URL(
          `../../../../server/cloud-services/node/guest/${path}`,
          import.meta.url,
        ),
        "utf8",
      ),
    })),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
    NODE_RUNTIME.runnerDigest,
    "Reviewed Node runner bytes changed",
  );
  const bridge = await readFile(
    new URL("./bridge.mjs", import.meta.url),
    "utf8",
  );
  const probe = await readFile(
    new URL("./gvisor-guest.mjs", import.meta.url),
    "utf8",
  );
  return [
    ...sources,
    { path: "bridge.mjs", content: bridge },
    { path: "gvisor-guest.mjs", content: probe },
  ].map((file) => ({
    guest_path: `/runtime/${file.path}`,
    raw_value: Buffer.from(file.content).toString("base64"),
  }));
}

export function flyMachineConfiguration({ name, proofId, files }) {
  assert.match(name, /^restyle-[a-f0-9]{24}-[0-9]{2}$/);
  assert.match(proofId, /^[a-f0-9]{24}$/);
  return {
    name,
    region: FLY_PROOF.region,
    skip_launch: true,
    skip_service_registration: true,
    skip_secrets: true,
    config: {
      image: `registry-1.docker.io/library/${NODE_RUNTIME.baseImage}`,
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: FLY_PROOF.memoryMiB },
      // This fixed diagnostic watchdog supplements host-side destruction; it is not an isolation boundary.
      init: {
        exec: [
          "/usr/bin/timeout",
          "--signal=KILL",
          String(FLY_PROOF.machineLifetimeSeconds),
          "node",
          "/runtime/server.mjs",
        ],
      },
      restart: { policy: "no" },
      auto_destroy: false,
      dns: { skip_registration: true },
      services: [],
      mounts: [],
      env: {},
      metadata: { restyle_proof: proofId },
      files,
    },
  };
}

/** Empty allow lists are a proof candidate, not a claim of deny-all support. Verify before source tests. */
export function flyNetworkPolicy() {
  return {
    name: "restyle-isolated-execution",
    selector: { all: true },
    rules: ["ingress", "egress"].map((direction) => ({
      action: "allow",
      direction,
      ports: [],
    })),
  };
}
