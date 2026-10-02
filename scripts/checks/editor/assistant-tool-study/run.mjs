import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { buildSchedule } from "./schedule.mjs";
import { sourceManifest, sha256 } from "./provenance.mjs";
import { runTrial } from "./trial.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  assert(argument.startsWith("--"), `Unexpected argument ${argument}`);
  const [key, ...values] = argument.slice(2).split("=");
  return [key, values.length ? values.join("=") : true];
}));
const allowed = new Set(["cases", "output", "study-url", "editor-url", "phase", "replicates", "seed", "timeout-ms", "bank", "list", "plan-only", "dry-run"]);
for (const key of Object.keys(options)) assert(allowed.has(key), `Unknown option --${key}`);
const { studyCases } = await import("./cases.mjs");
const { studyProtocol } = await import("./protocol.mjs");
assert.equal(new Set(studyCases.map(test => test.id)).size, studyCases.length);
if (options.list) {
  console.log(studyCases.map(test => `${test.id}\t${test.title}`).join("\n"));
  process.exit(0);
}
const phase = String(options.phase ?? "frozen");
assert(["frozen", "live"].includes(phase), "--phase must be frozen or live");
const defaults = phase === "live" ? ["opening-multimodal", "final-ranking-visual", "caption-followup"] : studyCases.map(test => test.id);
const selectedIds = options.cases ? String(options.cases).split(",") : defaults;
assert.equal(new Set(selectedIds).size, selectedIds.length, "Duplicate selected case");
for (const id of selectedIds) assert(studyCases.some(test => test.id === id), `Unknown case ${id}`);
const selected = studyCases.filter(test => selectedIds.includes(test.id));
const replicates = Number(options.replicates ?? (phase === "live" ? 2 : 3));
const seed = Number(options.seed ?? 20261002);
const timeoutMs = Number(options["timeout-ms"] ?? 300000);
assert(Number.isInteger(timeoutMs) && timeoutMs >= 10000 && timeoutMs <= 600000);
const schedule = buildSchedule(selected, { replicates, seed });
const output = path.resolve(String(options.output ?? `/tmp/pvo-assistant-tool-study-${phase}-${Date.now()}`));
const bankPath = path.resolve(String(options.bank ?? "/tmp/pvo-assistant-tool-study-evidence/bank.json"));
const dryRun = Boolean(options["dry-run"]);
const code = await sourceManifest(root);
const bankBytes = phase === "frozen" ? await readFile(bankPath) : null;
const mediaSources = await Promise.all([...new Set(selected.map(definition => definition.mediaPath ?? path.join(root, "share/assets/preview.mp4")))].map(async mediaPath => {
  const bytes = await readFile(mediaPath);
  return { path: mediaPath, bytes: bytes.length, sha256: sha256(bytes) };
}));
if (bankBytes) {
  const evidenceSource = JSON.parse(bankBytes).source;
  for (const media of mediaSources) assert.equal(media.sha256, evidenceSource.sha256, "Fixture source differs from frozen evidence source");
}
const config = {
  registeredAt: new Date().toISOString(), root, output, phase, dryRun, seed, replicates, timeoutMs,
  studyUrl: String(options["study-url"] ?? "http://127.0.0.1:5199"),
  editorUrl: String(options["editor-url"] ?? "http://127.0.0.1:5198/"),
  bankPath: phase === "frozen" ? bankPath : null, bankSha256: bankBytes ? sha256(bankBytes) : null,
  protocol: studyProtocol, sourceSha256: code.sha256, mediaSources, schedule,
  plannedCases: selected.map(definition => ({ id: definition.id, title: definition.title,
    mediaPath: definition.mediaPath, steps: definition.steps.map(step => ({ prompt: step.prompt,
      expect: step.expect, maxObservations: step.maxObservations })) })),
  measurement: "Serial matched real planning/editing trials. Frozen stage replays real recorded media evidence and does not measure end-to-end ASR/vision speed. Live stage invokes real media adapters. Native turns are not provider-call counts; server telemetry records underlying generation/review/repair and vision work. End-to-end includes external relay latency.",
};
// Refuse to overwrite preregistration or failed trials from an earlier run.
await mkdir(output);
await writeFile(path.join(output, "preregistration.json"), JSON.stringify(config, null, 2), { flag: "wx" });
await writeFile(path.join(output, "source-manifest.json"), JSON.stringify(code, null, 2), { flag: "wx" });
if (options["plan-only"]) {
  console.log(JSON.stringify({ event: "plan-written", output, trials: schedule.length, sourceSha256: code.sha256 }));
  process.exit(0);
}
let lookup = null;
if (phase === "frozen") {
  const { loadEvidenceBank, lookupFrozenObservation } = await import("./evidenceBank.mjs");
  const bank = await loadEvidenceBank(bankPath);
  lookup = (project, request) => lookupFrozenObservation(bank, project, request);
}
if (!dryRun) {
  const response = await fetch(`${new URL(config.studyUrl).origin}/study/health`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Study server not ready (${response.status})`);
  const health = await response.json();
  assert.equal(health.ready, true, "Study server is not ready");
  if (phase === "frozen") assert.equal(health.bankHash, config.bankSha256, "Study server loaded different frozen evidence");
  await writeFile(path.join(output, "server-health.json"), JSON.stringify(health, null, 2));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];
let infrastructureError = null;
const actualSchedule = dryRun ? schedule.filter(trial => trial.replicate === 1 && trial.pairPosition === 1) : schedule;
const saveSummary = async completed => {
  const summary = { ...config, completed, endedAt: new Date().toISOString(), plannedTrials: schedule.length,
    executedTrials: results.length, results, infrastructureError,
    counts: Object.fromEntries(["PASS", "FAIL", "FIXTURE_READY"].map(status => [status, results.filter(result => result.status === status).length])) };
  await writeFile(path.join(output, completed ? "summary.json" : "progress.json"), JSON.stringify(summary, null, 2));
  return summary;
};
try {
  for (const trial of actualSchedule) {
    if (!dryRun) {
      const current = await sourceManifest(root);
      assert.equal(current.sha256, code.sha256, "Source changed after preregistration; stop instead of mixing candidates");
    }
    if (bankBytes) assert.equal(sha256(await readFile(bankPath)), config.bankSha256, "Evidence bank changed after preregistration");
    const definition = selected.find(test => test.id === trial.caseId);
    const mediaPath = definition.mediaPath ?? path.join(root, "share/assets/preview.mp4");
    assert.equal(sha256(await readFile(mediaPath)), mediaSources.find(item => item.path === mediaPath).sha256,
      "Media source changed after preregistration");
    results.push(await runTrial({ browser, definition, trial, config, lookup }));
    await saveSummary(false);
  }
} catch (error) {
  infrastructureError = { name: error.name, message: error.message };
} finally { await browser.close(); }
const summary = await saveSummary(true);
console.log(JSON.stringify({ event: "study-completed", output, counts: summary.counts, infrastructureError }));
if (infrastructureError || results.some(result => result.status === "FAIL")) process.exitCode = 1;
