import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";
import { exerciseRecovery } from "./exercise.mjs";

const accountId = process.argv[2];
if (process.argv[3] !== "--run" || !/^[a-f0-9]{32}$/.test(accountId || "")) {
  console.error(
    "Usage: node scripts/checks/cloud-agent-recovery/run.mjs <account-id> --run",
  );
  process.exit(1);
}
const resources = await prepareResources(accountId);
const { report, save } = resources;
report.purpose = "1B.08/1B.09 production journal and provider recovery proof";
report.limits = {
  deployments: 1,
  coordinators: 2,
  releases: 2,
  dynamicWorkers: 2,
  probesPerRelease: 20,
  cpuMs: 50,
  subRequests: 0,
  proofMinutes: 20,
  callsFromDriver: 80,
};
let calls = 0;
try {
  const resource = await resources.prepare("recovery", {
    entrypoint: "scripts/checks/cloud-agent-recovery/proof-worker.js",
    bindings: [
      { name: "PROOF_TASKS", class_name: "ProofTasks" },
      { name: "SERVICE_HOSTS", class_name: "ProofRelease" },
    ],
    loaderBinding: "SERVICE_LOADER",
  });
  await resources.deploy(resource);
  // Preserve hashes of the exact dry-run bundle built immediately before deployment.
  report.bundle = {};
  const directory = resolve(resources.directory, "bundle-recovery");
  for (const name of await readdir(directory)) {
    if (!/\.(js|wasm)$/.test(name)) continue;
    report.bundle[name] = createHash("sha256")
      .update(await readFile(resolve(directory, name)))
      .digest("hex");
  }
  await save();
  await resources.ready(resource);
  const call = (path, method = "GET", authenticated = true) => {
    if (++calls > report.limits.callsFromDriver)
      throw new Error("Proof request limit reached");
    return resources.call(resource, path, method, undefined, authenticated);
  };
  report.results = await exerciseRecovery(call, {
    cpu: true,
    record: async (description, snapshot) => {
      report.checks.push(description);
      if (snapshot) (report.snapshots ??= []).push(snapshot);
      await save();
      console.log(description);
    },
  });
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  report.driverCalls = calls;
  await resources.cleanup();
  if (!report.cleanupVerified) process.exitCode = 1;
  console.log(
    JSON.stringify({
      passed: report.passed ?? false,
      failure: report.failure,
      cleanupVerified: report.cleanupVerified,
      reportFile: resources.reportFile,
    }),
  );
}
