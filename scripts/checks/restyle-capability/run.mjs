import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { nativeAssistantTurn } from "../../../server/assistant/native/service.js";
import { inspectNativeFrames } from "../../../server/assistant/native/vision.js";
import { comparisonSandbox } from "../model-comparison/sandbox.mjs";
import { digest } from "../model-comparison/workspace.mjs";
import { baseline, measuredModels } from "./provider.mjs";
import { planningProbes, editorProbes, visionProbes } from "./probes.mjs";
import { buildScenarios } from "./build-scenarios.mjs";
import { runBuild } from "./build.mjs";
import { runPlanning } from "./planning.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: "string" },
    repetitions: { type: "string", default: "2" },
    label: { type: "string" },
  },
});
const selected = positionals[0] ?? "all";
const repetitions = Number(values.repetitions);
if (!Number.isSafeInteger(repetitions) || repetitions < 1)
  throw new Error("Repetitions must be a positive integer.");
if (!["all", "probes", "builds", "resume"].includes(selected))
  throw new Error(
    "Select all, probes, builds, or resume followed by a journal path.",
  );
const previous =
  selected === "resume"
    ? JSON.parse(await readFile(positionals[1], "utf8"))
    : null;
const completed = new Set(
  (previous?.runs ?? [])
    .filter(
      (row) =>
        !["running", "operator_interrupted"].includes(row.status) &&
        !row.invalidForScoring,
    )
    .map((row) => `${row.id}.${row.repetition}`),
);
const directory = join(
  homedir(),
  ".codex/secure/restyle-capability",
  `run-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
let probes = [...planningProbes(), ...editorProbes, ...visionProbes];
let builds = buildScenarios();
if (values.cases) {
  const ids = values.cases.split(",");
  const all = [...probes, ...builds];
  if (ids.some((id) => !all.some((scenario) => scenario.id === id)))
    throw new Error("Unknown scenario in --cases.");
  probes = probes.filter((scenario) => ids.includes(scenario.id));
  builds = builds.filter((scenario) => ids.includes(scenario.id));
}
const report = {
  protocol: "restyle-capability-v1.4",
  selected,
  predecessor: previous ? positionals[1] : null,
  experiment: values.label ?? null,
  retainedRuns: [...completed],
  startedAt: new Date().toISOString(),
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  baseline,
  modelTurnLimit: null,
  buildObservationMs: 600000,
  repetitions,
  cases: [...probes, ...builds],
  frozenFiles: {},
  resources: [],
  runs: [],
};
const files = [
  "docs/engineering/restyle-cloud-agent-roadmaps/06-capability-baseline.md",
  ...(await readdir("scripts/checks/restyle-capability"))
    .filter((x) => x.endsWith(".mjs"))
    .map((x) => "scripts/checks/restyle-capability/" + x),
  ...(await readdir("scripts/checks/restyle-capability/fixtures")).map(
    (x) => "scripts/checks/restyle-capability/fixtures/" + x,
  ),
  "scripts/checks/model-comparison/review.mjs",
  "scripts/checks/model-comparison/scenarios.mjs",
  "scripts/checks/model-comparison/workspace.mjs",
  "scripts/checks/model-comparison/sandbox.mjs",
];
for (const file of files)
  report.frozenFiles[file] = digest(await readFile(file));
report.matrixDigest = digest(JSON.stringify(report.cases));
if (previous && previous.matrixDigest !== report.matrixDigest)
  throw new Error("Resume cannot change the frozen input matrix.");
let pending = Promise.resolve();
function save() {
  const content = JSON.stringify(report, null, 2) + "\n";
  pending = pending.then(async () => {
    await writeFile(join(directory, "report.tmp"), content, { mode: 0o600 });
    await rename(join(directory, "report.tmp"), join(directory, "report.json"));
  });
  return pending;
}
await save();
console.log(`Journal: ${directory}/report.json`);
let sandbox;
if (selected !== "probes") {
  sandbox = await comparisonSandbox(async (resource) => {
    const index = report.resources.findIndex((x) => x.name === resource.name);
    if (index < 0) report.resources.push(structuredClone(resource));
    else report.resources[index] = structuredClone(resource);
    await save();
  });
  report.runtime = { image: sandbox.image, nodeVersion: sandbox.nodeVersion };
  await save();
}
async function run(scenario, repetition) {
  if (completed.has(`${scenario.id}.${repetition}`)) return;
  const row = {
    id: scenario.id,
    family: scenario.family,
    repetition,
    status: "running",
    startedAt: new Date().toISOString(),
    attempts: [],
    developerInterventions: 0,
  };
  report.runs.push(row);
  const started = performance.now();
  const models = await measuredModels(async (attempt) => {
    row.attempts[attempt.sequence - 1] = attempt;
    await save();
  });
  console.log(`Start ${row.id}.${repetition}`);
  try {
    if (["build", "repair"].includes(scenario.family))
      await runBuild(scenario, row, sandbox, models, save);
    else if (scenario.family === "planning")
      await runPlanning(scenario, row, models, save);
    else if (scenario.family === "editor") {
      row.trace = [];
      row.output = await nativeAssistantTurn(scenario.request, {
        models,
        signal: AbortSignal.timeout(90000),
        savedTasks: true,
        compile: async () => {
          throw new Error("Unexpected compilation in command-only probe.");
        },
        trace: (entry) =>
          row.trace.push({ ...entry, error: entry.error?.message }),
      });
      row.status = "needs_semantic_grade";
    } else {
      const png = await readFile(
        new URL(`./fixtures/${scenario.fixture}`, import.meta.url),
      );
      const observations = [
        {
          kind: "frames",
          sceneId: "main",
          start: 1,
          end: 1,
          coverage: "video-and-text",
          note: "Synthetic single frame.",
          frames: [
            {
              sceneTime: 1,
              clipId: 1,
              sourceTime: 1,
              dataUrl: `data:image/png;base64,${png.toString("base64")}`,
              width: 960,
              height: 540,
            },
          ],
        },
      ];
      row.output = await inspectNativeFrames(
        { prompt: scenario.prompt, observations },
        { models, signal: AbortSignal.timeout(90000) },
      );
      row.status = "needs_semantic_grade";
    }
  } catch (error) {
    row.status = error.feedback ? "validation_rejected" : "execution_error";
    row.failure = {
      message: error.message,
      code: error.code ?? null,
      feedback: error.feedback ?? null,
    };
  }
  row.elapsedMs = performance.now() - started;
  row.completedAt = new Date().toISOString();
  row.knownEstimatedUsd = row.attempts.reduce(
    (n, a) => n + (a.usage?.estimatedUsd ?? 0),
    0,
  );
  row.unknownUsageAttempts = row.attempts.filter((a) => !a.usage).length;
  await save();
  console.log(
    `End ${row.id}.${repetition}: ${row.status}; ${Math.round(row.elapsedMs / 1000)}s; ${row.attempts.length} calls; known estimate $${row.knownEstimatedUsd.toFixed(4)}`,
  );
}
// Sequential cases avoid cross-case contention and make latency interpretable.
for (let repetition = 1; repetition <= repetitions; repetition++) {
  if (selected !== "builds")
    for (const probe of probes) await run(probe, repetition);
  if (selected !== "probes")
    for (const scenario of builds) await run(scenario, repetition);
}
report.completedAt = new Date().toISOString();
report.cleanupVerified = report.resources.every((x) => x.cleaned);
await save();
console.log(
  `Complete; cleanup=${report.cleanupVerified}; ${report.runs.length} runs. Journal: ${directory}/report.json`,
);
