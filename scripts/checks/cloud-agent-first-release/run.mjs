import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";
import { exerciseAuthoring } from "./exercise.mjs";
import { scenarios } from "./scenarios.js";

const accountId = process.argv[2];
if (
  process.argv[3] !== "--run-approved-15-usd" ||
  process.argv.length !== 4 ||
  !/^[a-f0-9]{32}$/.test(accountId ?? "")
) {
  console.error(
    "Usage (only after fresh approval): node scripts/checks/cloud-agent-first-release/run.mjs <account-id> --run-approved-15-usd",
  );
  process.exit(1);
}
async function modelKey() {
  if (process.env.RUNPOD_API_KEY?.trim())
    return process.env.RUNPOD_API_KEY.trim();
  try {
    const config = await readFile(
      resolve(homedir(), ".runpod/config.toml"),
      "utf8",
    );
    const match = /^\s*apikey\s*=\s*"([^"\r\n]+)"\s*$/m.exec(config);
    if (match?.[1]) return match[1];
  } catch {
    /* Never print private configuration. */
  }
  throw new Error(
    "Supply RUNPOD_API_KEY privately or configure the Runpod CLI.",
  );
}
const apiKey = await modelKey();
const resources = await prepareResources(accountId);
const { report, save } = resources;
const expiresAt = Date.now() + 90 * 60_000;
report.purpose =
  "1F natural-language acceptance preparation: actual Runpod Kimi planning and Cloudflare tools, no production deployment";
report.limits = {
  approvedUsd: 15,
  reservedModelUsd: 13,
  infrastructureAllowanceUsd: 2,
  deployments: 1,
  containerApplications: 1,
  namespaces: 6,
  creators: 2,
  globalConcurrentSessions: 2,
  globalDailySessions: 12,
  sessionSeconds: 120,
  commandSeconds: 15,
  requestLimit: 2000,
  expiresAt,
};
report.scenarios = scenarios;
await save();
let resource;
const controller = new AbortController();
const stop = () =>
  controller.abort(
    new Error("Diagnostic interrupted; cleaning up recorded resources."),
  );
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  resource = await resources.prepare("workspace", {
    entrypoint: "scripts/checks/cloud-agent-first-release/worker.js",
    containerClassName: "AcceptanceWorkspace",
    loaderBinding: "SERVICE_LOADER",
    expiresAt,
    bindings: [
      { name: "ASSISTANT_TASKS", class_name: "AcceptanceTasks" },
      { name: "ASSISTANT_BUDGET", class_name: "AssistantBudget" },
      { name: "ASSISTANT_WORKSPACES", class_name: "AcceptanceWorkspace" },
      { name: "WORKSPACE_BUDGET", class_name: "WorkspaceBudget" },
      { name: "SERVICE_HOSTS", class_name: "HostedService" },
      { name: "PROOF_CONTROL", class_name: "AcceptanceControl" },
    ],
    vars: {
      ASSISTANT_PROVIDER: "runpod",
      ASSISTANT_TASK_SPENDING: JSON.stringify(
        Object.keys(scenarios).map((subject) => ({
          ownerId: `proof-${resources.id}-${subject}`,
          expiresAt,
          capabilities: ["model", "workspace", "hosting"],
        })),
      ),
    },
    secrets: { RUNPOD_API_KEY: apiKey },
  });
  // The platform uses this address for saved attachments; never a VM address.
  const config = JSON.parse(await readFile(resource.config, "utf8"));
  config.vars.PUBLIC_ORIGIN = resource.url;
  await writeFile(resource.config, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  await resources.deploy(resource);
  await resources.ready(resource);
  await exerciseAuthoring(
    (...args) => resources.call(resource, ...args),
    async (subject, snapshot) => {
      (report.snapshots ??= []).push({
        subject,
        observedAt: new Date().toISOString(),
        ...snapshot,
      });
      await save();
      console.log(
        `${subject}: ${snapshot.task.state}, ${snapshot.task.stepId}, revision ${snapshot.task.revision}`,
      );
    },
    { expiresAt, signal: controller.signal },
  );
  report.authoringPassed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  if (resource?.attempted) {
    try {
      report.usage = (await resources.call(resource, "/usage")).data;
    } catch {
      report.usageUnavailable = true;
    }
  }
  await resources.cleanup();
  if (!report.cleanupVerified) process.exitCode = 1;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  console.log(
    JSON.stringify({
      authoringPassed: report.authoringPassed ?? false,
      failure: report.failure,
      cleanupVerified: report.cleanupVerified,
      reportFile: resources.reportFile,
    }),
  );
}
