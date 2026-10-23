import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";
import { exerciseWorkspaces } from "./exercise.mjs";

const accountId = process.argv[2];
if (process.argv[3] !== "--run" || !/^[a-f0-9]{32}$/.test(accountId ?? "")) {
  console.error(
    "Usage: node scripts/checks/cloud-agent-workspaces/run.mjs <account-id> --run",
  );
  process.exit(1);
}
const resources = await prepareResources(accountId);
const { report, save } = resources;
report.purpose =
  "1C private workspace provider acceptance; no model or product deployment";
report.limits = {
  deployments: 1,
  containerApplications: 1,
  namespaces: 2,
  workspaceIdentities: 4,
  globalConcurrentSessions: 2,
  globalDailySessions: 12,
  sessionSeconds: 120,
  commandSeconds: 15,
  startSeconds: 20,
  outputBytes: 16384,
  driverCalls: 50,
  workerCalls: 60,
  proofMinutes: 20,
  modelCalls: 0,
};
let calls = 0;
try {
  const resource = await resources.prepare("workspace", {
    entrypoint: "scripts/checks/cloud-agent-workspaces/proof-worker.js",
    bindings: [
      { name: "ASSISTANT_WORKSPACES", class_name: "WorkspaceProof" },
      { name: "WORKSPACE_BUDGET", class_name: "WorkspaceProofBudget" },
    ],
    containerClassName: "WorkspaceProof",
  });
  await save();
  await resources.deploy(resource);
  report.bundle = {};
  const directory = resolve(resources.directory, "bundle-workspace");
  for (const name of await readdir(directory))
    if (/\.(js|wasm)$/.test(name))
      report.bundle[name] = createHash("sha256")
        .update(await readFile(resolve(directory, name)))
        .digest("hex");
  await save();
  await resources.ready(resource);
  const call = (path, method = "GET", authenticated = true) => {
    if (++calls > report.limits.driverCalls)
      throw new Error("Workspace proof request limit reached");
    return resources.call(resource, path, method, undefined, authenticated);
  };
  await exerciseWorkspaces(call, async (description, snapshot) => {
    report.checks.push(description);
    if (snapshot) (report.snapshots ??= []).push(snapshot);
    await save();
    console.log(description);
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
