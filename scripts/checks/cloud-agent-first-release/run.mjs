import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";
import { exerciseAuthoring } from "./exercise.mjs";
import { scenarios } from "./scenarios.js";
import { readRunpodKey } from "./credentials.mjs";
import { openCreatorJourney } from "./browser.mjs";
import { checkGeneratedDelivery } from "./delivery.mjs";
import { reviewedInputs } from "./review-inputs.mjs";

const accountId = process.argv[2];
if (
  process.argv[3] !== "--run-approved-10-usd" ||
  process.argv.length !== 4 ||
  !/^[a-f0-9]{32}$/.test(accountId ?? "")
) {
  console.error(
    "Usage (only after replacement approval): node scripts/checks/cloud-agent-first-release/run.mjs <account-id> --run-approved-10-usd",
  );
  process.exit(1);
}
const apiKey = await readRunpodKey();
const sourceUrl = process.env.EDITOR_URL || "http://127.0.0.1:5318/";
const sourceOrigin = new URL(sourceUrl);
if (
  sourceOrigin.protocol !== "http:" ||
  sourceOrigin.hostname !== "127.0.0.1" ||
  !(await fetch(sourceUrl)).ok
)
  throw new Error("Start the isolated local editor before the paid run");
const resources = await prepareResources(accountId);
const { report, save } = resources;
const expiresAt = Date.now() + 90 * 60_000;
report.purpose =
  "1F natural-language acceptance preparation: actual Runpod Kimi planning and Cloudflare tools, no production deployment";
report.limits = {
  approvedUsd: 10,
  reservedModelUsd: 8,
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
let resource, journey;
const record = async (check, detail) => {
  report.checks.push({
    check,
    observedAt: new Date().toISOString(),
    ...detail,
  });
  await save();
  console.log(`Acceptance: ${check}`);
};
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
  const call = (...args) => resources.call(resource, ...args);
  journey = await openCreatorJourney({
    origin: resource.url,
    sourceUrl,
    proofId: resources.id,
    call,
    record,
  });
  await exerciseAuthoring(
    call,
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
    {
      expiresAt,
      signal: controller.signal,
      start: journey.start,
      record,
      onReady: async (subject, snapshot) => {
        const directory = dirname(resources.reportFile);
        const file = `${directory}/${subject}-inputs.json`;
        await record("awaiting_reviewed_delivery_inputs", { subject, file });
        const plan = await reviewedInputs(file, {
          expiresAt,
          signal: controller.signal,
        });
        await record("reviewed_delivery_inputs", { subject, plan });
        await checkGeneratedDelivery({
          journey,
          subject,
          snapshot,
          plan,
          record,
          directory,
          call,
        });
      },
    },
  );
  report.authoringPassed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await journey?.close().catch(() => {});
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
