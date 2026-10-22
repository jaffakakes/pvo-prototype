import { mkdir, writeFile, rename } from "node:fs/promises";
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
import { planningProbes } from "./probes.mjs";
import { isolatedTaskEffects } from "./effects.mjs";

const scenario = process.argv[2] ?? "guestbook";
if (scenario !== "guestbook")
  throw new Error("Select the guestbook durable journey.");
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
const send = await measuredFetch(async (attempt) => {
  report.attempts[attempt.sequence - 1] = attempt;
  await save();
});
let fixture,
  task,
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
    modelFetch: (request) => forwardModelRequest(send, request),
    ...isolatedTaskEffects(sandbox),
    researchFetch: async () => new Response(null, { status: 503 }),
  });
  report.resources[0].storagePath = fixture.storagePath;
  await save();
  const project = await fixture.project("reliability-guestbook");
  expectStatus(project, 200);
  const request = {
    ...input(),
    projectId: project.body.project.id,
    request:
      planningProbes().find((item) => item.id === "P01").request +
      " Add a new form with name and message fields and a Save button to the main scene. Use a short duration and pause playback until submission. Keep the original request's storage and reading behavior.",
    examples: [],
    context: { ...input().context, components: [] },
  };
  report.request = request;
  const created = await fixture.create(project.body.project.id, request);
  expectStatus(created, 201);
  task = created.body.task;
  report.taskId = task.id;
  await save();
  let signature;
  const deadline = Date.now() + report.observationMs;
  while (!stopping && Date.now() < deadline) {
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
    await fixture.restart();
    const restored = await fixture.request(path(task) + "/result");
    expectStatus(restored, 200);
    report.resultSurvivedRestart =
      JSON.stringify(restored.body) === JSON.stringify(result.body);
    if (!report.resultSurvivedRestart)
      throw new Error("Prepared result changed across restart.");
  }
} catch (error) {
  report.status = "execution_error";
  report.failure = { name: error.name, message: error.message };
} finally {
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
