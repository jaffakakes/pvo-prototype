import { mkdir, writeFile, rename, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  taskFixture,
  path,
  expectStatus,
} from "../../../tests/assistant-task-server/helpers.mjs";
import { input } from "../../../tests/assistant-tasks/fixtures.mjs";
import { comparisonSandbox } from "../model-comparison/sandbox.mjs";
import { measuredFetch, forwardModelRequest, baseline } from "./provider.mjs";
import { isolatedTaskEffects } from "./effects.mjs";
import { createDurableBrowser } from "./durable-browser.mjs";
import { checkDurableDelivery } from "./durable-delivery.mjs";
import { controlledEmail, checkEmailDelivery } from "./durable-email.mjs";
import { checkEmailReceiptBounds } from "./email-boundary.mjs";
import { pressureJourney } from "./pressure-journeys.mjs";
import { checkPressureBrowser } from "./pressure-browser.mjs";
import {
  durableScenario,
  seedDurableScenario,
  checkDurableSetup,
} from "./durable-scenarios.mjs";

import {
  lostInferenceReply,
  restartLostInference,
} from "./durable-interruption.mjs";

const scenario = process.argv[2] ?? "guestbook";
const browserJourney = process.argv.includes("--browser");
const loseFirstReply = process.argv.includes("--lose-first-reply");
const scenarioInput = pressureJourney(scenario) ?? durableScenario(scenario);
if (
  browserJourney &&
  !scenarioInput.pressure &&
  !["guestbook", "connected-email"].includes(scenario)
)
  throw new Error("Browser delivery uses guestbook or connected-email.");
const directory = join(
  homedir(),
  ".codex/secure/restyle-capability",
  `durable-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = {
  protocol: "restyle-durable-reliability-v1",
  scenario,
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  startedAt: new Date().toISOString(),
  baseline,
  status: "running",
  observationMs: 1200000,
  attempts: [],
  resources: [
    {
      kind: "local-worker",
      name: "saved-task-fixture",
      requestedAt: new Date().toISOString(),
      cleaned: false,
    },
  ],
  transitions: [],
  browserJourney,
  loseFirstReply,
  interruptionChecks: [],
  browserChecks: [],
};
let saving = Promise.resolve();
function save() {
  const bytes = JSON.stringify(report, null, 2) + "\n";
  saving = saving.then(async () => {
    await writeFile(join(directory, "report.tmp"), bytes, { mode: 0o600 });
    await rename(join(directory, "report.tmp"), join(directory, "report.json"));
  });
  return saving;
}
await save();
console.log(`Journal: ${directory}/report.json`);
const sandbox = await comparisonSandbox(async (resource) => {
  const prior = report.resources.findIndex(
    (item) => item.name === resource.name,
  );
  if (prior < 0) report.resources.push(structuredClone(resource));
  else report.resources[prior] = structuredClone(resource);
  await save();
});
report.runtime = { image: sandbox.image, nodeVersion: sandbox.nodeVersion };
const email = scenarioInput.connectedEmail ? controlledEmail() : null;
const send = await measuredFetch(async (attempt) => {
  report.attempts[attempt.sequence - 1] = attempt;
  await save();
});
let fixture,
  task,
  creator,
  stopping = false;
const interrupt = () => {
  stopping = true;
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  fixture = await taskFixture({
    realClock: true,
    workspaces: true,
    services: true,
    modelFetch: loseFirstReply
      ? lostInferenceReply(send, async (check) => {
          report.interruptionChecks.push(check);
          await save();
        })
      : (request) => forwardModelRequest(send, request),
    ...isolatedTaskEffects(sandbox),
    researchFetch:
      email?.researchFetch ?? (async () => new Response(null, { status: 503 })),
    connectionFetch: email?.connectionFetch,
    connectionKey: scenarioInput.connectionKey,
  });
  report.resources[0].storagePath = fixture.storagePath;
  await save();
  await seedDurableScenario(fixture, scenarioInput);
  if (email) await email.seed(fixture);
  const request = scenarioInput.request;
  if (browserJourney) {
    report.resources.push({
      kind: "browser",
      name: "generated-component-journey",
      requestedAt: new Date().toISOString(),
      cleaned: false,
    });
    await save();
    creator = await createDurableBrowser(fixture, request, directory);
    task = creator.task;
  } else {
    const project = await fixture.project("reliability-guestbook");
    expectStatus(project, 200);
    const created = await fixture.create(project.body.project.id, {
      ...input(),
      projectId: project.body.project.id,
      request,
      examples: [],
      context: { ...input().context, components: [] },
    });
    expectStatus(created, 201);
    task = created.body.task;
  }
  report.request = task.input;
  report.taskId = task.id;
  await save();
  let signature;
  const deadline = Date.now() + report.observationMs;
  while (!stopping && Date.now() < deadline) {
    // A private stop marker lets the owner request normal teardown without Miniflare's process signal handler exiting first.
    if (
      await access(join(directory, "stop")).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      )
    ) {
      stopping = true;
      break;
    }
    const response = await fixture.request(path(task));
    expectStatus(response, 200);
    task = response.body.task;
    const next = JSON.stringify([
      task.state,
      task.stepId,
      task.revision,
      task.usage.modelTurns,
    ]);
    if (next !== signature) {
      signature = next;
      report.transitions.push({ at: new Date().toISOString(), task });
      await save();
      console.log(
        `${task.state} / ${task.stepId}; ${task.usage.modelTurns} model calls`,
      );
    }
    if (
      loseFirstReply &&
      task.state === "waiting" &&
      task.wait?.reason === "model_connection" &&
      report.interruptionChecks.length === 1
    ) {
      report.interruptionChecks.push(await restartLostInference(fixture, task));
      await save();
      continue;
    }
    if (
      ["ready", "failed", "stopped", "waiting_for_answer"].includes(task.state)
    )
      break;
    await delay(1000);
  }
  await fixture.control({ action: "pause-planning" });
  report.finalTask = task;
  report.status =
    task.state === "ready"
      ? "ready_needs_semantic_grade"
      : stopping
        ? "operator_interrupted"
        : ["failed", "stopped", "waiting_for_answer"].includes(task.state)
          ? task.state
          : "observation_window_exhausted";
  for (const action of [
    "builder-state",
    "validation-state",
    "workspace-rows",
    "provider-rows",
    "evidence-context",
    "progress-context",
  ])
    report[action] = (await fixture.control({ action, id: task.id })).body;
  if (task.state === "ready") {
    const result = await fixture.request(path(task) + "/result");
    expectStatus(result, 200);
    report.preparedResult = result.body;
    if (email && !scenarioInput.pressure) {
      const identity = result.body.attachment.receipt.identity;
      const artifact = report["validation-state"].artifacts.find(
        (row) => row.artifact.identity.packageDigest === identity.packageDigest,
      )?.artifact;
      if (!artifact)
        throw new Error(
          "The prepared email result has no matching checked package.",
        );
      report.receiptBoundaryChecks = [];
      await checkEmailReceiptBounds(
        artifact.agreement,
        (invocation) =>
          sandbox.execute(
            artifact.package.files,
            artifact.package.entrypoint,
            invocation,
          ),
        async (result) => {
          report.receiptBoundaryChecks.push(result);
          await save();
        },
      );
    }
    await fixture.restart();
    const restored = await fixture.request(path(task) + "/result");
    expectStatus(restored, 200);
    report.resultSurvivedRestart =
      JSON.stringify(restored.body) === JSON.stringify(result.body);
    if (!report.resultSurvivedRestart)
      throw new Error("Prepared result changed across restart.");
    await save();
    if (creator) {
      await (
        scenarioInput.pressure
          ? checkPressureBrowser
          : email
            ? checkEmailDelivery
            : checkDurableDelivery
      )(
        creator,
        fixture,
        directory,
        async (kind, data) => {
          report.browserChecks.push({
            at: new Date().toISOString(),
            kind,
            ...data,
          });
          await save();
        },
        email,
        scenarioInput,
      );
      report.browserPassed = true;
    }
  }
  if (scenarioInput.connectionKey && !email) {
    report.setupCheck = await checkDurableSetup(fixture, task);
    report.status = "private_setup_verified";
  }
} catch (error) {
  report.status = "execution_error";
  report.failure = {
    name: error.name,
    message: error.message,
    stack: error.stack?.slice(0, 4000),
  };
  if (error.browserCleanupVerified)
    report.resources.find((item) => item.kind === "browser").cleaned = true;
  if (creator && !creator.page.isClosed()) {
    try {
      await creator.page.screenshot({ path: directory + "/failure.png" });
      report.browserFailureText = await creator.page
        .locator("body")
        .innerText();
    } catch (captureError) {
      report.browserFailureCapture = captureError.message;
    }
  }
} finally {
  if (creator) {
    report.browserErrors = creator.errors;
    await creator.close();
    report.resources.find((item) => item.kind === "browser").cleaned = true;
  }
  if (fixture) {
    if (task && task.state !== "ready") {
      const current = (await fixture.request(path(task))).body.task;
      if (current && !["stopped", "failed"].includes(current.state))
        report.stop = await fixture.request(path(task) + "/stop", {
          body: { expectedRevision: current.revision },
        });
    }
    await fixture.close();
    report.resources[0].cleaned = true;
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  report.completedAt = new Date().toISOString();
  report.cleanupVerified = report.resources.every(
    (resource) => resource.cleaned,
  );
  report.knownEstimatedUsd = report.attempts.reduce(
    (total, attempt) => total + (attempt.usage?.estimatedUsd ?? 0),
    0,
  );
  report.unknownUsageAttempts = report.attempts.filter(
    (attempt) => !attempt.usage,
  ).length;
  await save();
  console.log(
    `Complete: ${report.status}; ${report.attempts.length} calls; cleanup=${report.cleanupVerified}`,
  );
}
