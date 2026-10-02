import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { acceptanceFixture, fixtureDescription } from "./fixtures.mjs";
import { installAcceptanceHarness } from "./browserHarness.mjs";
import { installRealTransport } from "./transport.mjs";
import { verifyWorkflow } from "./assertions.mjs";
import { editingCases } from "./editingCases.mjs";
import { conversationCases } from "./conversationCases.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  assert(argument.startsWith("--"), `Unexpected argument ${argument}`);
  const [key, ...values] = argument.slice(2).split("=");
  return [key, values.length ? values.join("=") : true];
}));
const allowed = new Set(["cases", "output", "api-url", "editor-url", "concurrency", "timeout-ms", "list", "fixture-only", "media-path"]);
for (const key of Object.keys(options)) assert(allowed.has(key), `Unknown option --${key}`);
const mediaModule = new URL("./media-cases.mjs", import.meta.url);
const mediaCases = existsSync(mediaModule) ? (await import(mediaModule.href)).mediaCases : [];
const allCases = [...editingCases, ...conversationCases, ...mediaCases];
assert.equal(new Set(allCases.map(test => test.id)).size, allCases.length, "Case identifiers must be unique");
if (options.list) {
  console.log(allCases.map(test => `${test.id}\t${test.classification ?? "acceptance"}\t${test.title}`).join("\n"));
  process.exit(0);
}
const selectedIds = options.cases ? String(options.cases).split(",") : allCases.map(test => test.id);
for (const id of selectedIds) assert(allCases.some(test => test.id === id), `Unknown case ${id}; use --list`);
const selected = allCases.filter(test => selectedIds.includes(test.id));
const concurrency = Number(options.concurrency ?? 1);
assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 2, "Concurrency must be 1 or 2");
const timeoutMs = Number(options["timeout-ms"] ?? 300000);
assert(Number.isInteger(timeoutMs) && timeoutMs >= 10000 && timeoutMs <= 600000, "Request timeout must be 10000–600000 ms");
const apiUrl = String(options["api-url"] ?? "http://127.0.0.1:4174");
const editorUrl = String(options["editor-url"] ?? "http://127.0.0.1:5196/");
const output = path.resolve(String(options.output ?? `/tmp/pvo-assistant-acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}`));
const config = {
  startedAt: new Date().toISOString(), root, apiUrl, editorUrl, concurrency, timeoutMs,
  fixtureOnly: Boolean(options["fixture-only"]), cases: selected.map(test => test.id), fixtureDescription,
  plannedCases: selected.map(test => ({ id: test.id, title: test.title, steps: test.steps.map(step => ({
    prompt: step.prompt, expect: step.expect, classification: step.classification ?? test.classification ?? "acceptance",
  })) })),
  measurement: "End-to-end includes native API, media extraction, validation/compiler and any external relay latency. Native turn count is not underlying provider model-call count; provider review/repair may add calls. Playback/export host effects are recorded, not executed by this runner.",
};
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "config.json"), JSON.stringify(config, null, 2));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [];

async function loadMedia(page, mediaPath) {
  assert(existsSync(mediaPath), `Fixture video not found: ${mediaPath}`);
  await page.route("**/__acceptance_media.mp4", route => route.fulfill({ path: mediaPath, contentType: "video/mp4" }));
  return page.evaluate(async () => {
    const response = await fetch("/__acceptance_media.mp4");
    if (!response.ok) throw new Error("Could not load fixture media");
    const url = URL.createObjectURL(await response.blob());
    const video = document.createElement("video");
    video.preload = "metadata";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Fixture metadata timed out")), 15000);
        video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error("Fixture video could not be decoded")); };
        video.src = url;
      });
      return { url, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    } finally { video.removeAttribute("src"); video.load(); }
  });
}

async function runCase(definition) {
  const started = performance.now();
  const directory = path.join(output, definition.id);
  await mkdir(directory, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const network = [], browserErrors = [], failures = [], steps = [], browserVerification = { status: "not-requested", events: [] };
  page.on("pageerror", error => browserErrors.push(error.message));
  await installRealTransport(context, apiUrl, network);
  let initial = null, media = null;
  console.log(JSON.stringify({ event: "case-started", id: definition.id, title: definition.title }));
  try {
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 30000 });
    const mediaPath = String(options["media-path"] ?? definition.mediaPath ?? path.join(root, "share/assets/preview.mp4"));
    media = { ...(await loadMedia(page, mediaPath)), path: mediaPath };
    const fixture = (definition.fixture ?? acceptanceFixture)(media);
    initial = await page.evaluate(installAcceptanceHarness, {
      root, fixture, advanced: definition.advanced ?? false, timeoutMs, seedComponents: definition.seedComponents ?? true,
    });
    await writeFile(path.join(directory, "initial.json"), JSON.stringify(initial, null, 2));
    if (!options["fixture-only"]) {
      for (const [index, expectation] of definition.steps.entries()) {
        console.log(JSON.stringify({ event: "step-started", case: definition.id, step: index + 1, prompt: expectation.prompt }));
        const step = await page.evaluate(input => window.__nativeAcceptance.run(input), {
          prompt: expectation.prompt, mode: expectation.mode ?? "edit",
        });
        step.expectation = { outcome: expectation.expect, maxObservations: expectation.maxObservations,
          classification: expectation.classification ?? definition.classification ?? "acceptance" };
        step.assertionFailures = verifyWorkflow(step, expectation);
        steps.push(step);
        try { await expectation.verify?.(step, { steps, initial }); }
        catch (error) { step.assertionFailures.push({ assertion: "scenario postconditions", message: error.message }); }
        failures.push(...step.assertionFailures.map(failure => ({ step: index + 1, ...failure })));
        await writeFile(path.join(directory, `step-${index + 1}.json`), JSON.stringify(step, null, 2));
        console.log(JSON.stringify({ event: "step-completed", case: definition.id, step: index + 1,
          endToEndMs: step.endToEndMs, nativeTurns: step.turns.length, observations: step.observations.length,
          failures: step.assertionFailures, failure: step.failure }));
        // A failed prerequisite makes later follow-ups ungrounded. Other independent cases still run.
        if (step.failure || step.assertionFailures.length) break;
      }
      if (definition.verifyBrowser) {
        browserVerification.status = failures.length ? "skipped-model-failure" : "running";
        if (!failures.length) {
          const started = performance.now();
          try {
            await definition.verifyBrowser({ page, steps, initial, directory,
              record: event => browserVerification.events.push({ atMs: Math.round(performance.now() - started), ...event }) });
            browserVerification.status = "PASS";
          } catch (error) {
            browserVerification.status = "FAIL";
            browserVerification.error = { name: error.name, message: error.message };
            failures.push({ assertion: "real rendered interaction", message: error.message });
          } finally { browserVerification.durationMs = Math.round(performance.now() - started); }
        }
        await writeFile(path.join(directory, "browser-verification.json"), JSON.stringify(browserVerification, null, 2));
      }
    }
  } catch (error) {
    failures.push({ assertion: "test infrastructure", message: error.stack ?? error.message });
  } finally {
    if (browserErrors.length) failures.push({ assertion: "browser errors", message: browserErrors.join("\n") });
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => {});
    await context.close();
  }
  const classification = definition.classification ?? (definition.steps.some(step => step.classification === "capability-gap") ? "capability-gap" : "acceptance");
  const status = failures.length ? "FAIL" : options["fixture-only"] ? "FIXTURE_READY"
    : classification === "capability-gap" ? "CAPABILITY_GAP" : "PASS";
  const summary = { id: definition.id, title: definition.title, status, classification,
    wallMs: Math.round(performance.now() - started), requestMs: steps.reduce((sum, step) => sum + step.endToEndMs, 0),
    nativeTurnRequests: steps.reduce((sum, step) => sum + step.turns.length, 0),
    observations: steps.flatMap(step => step.observations).map(item => item.request.kind),
    preparationAttempts: steps.reduce((sum, step) => sum + step.preparations.length, 0),
    browserVerification: { status: browserVerification.status, durationMs: browserVerification.durationMs },
    completedSteps: steps.length, plannedSteps: definition.steps.length,
    plannedRequests: definition.steps.map(step => ({ prompt: step.prompt, expect: step.expect })),
    failures, artifactDirectory: directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify({ ...summary, media, network, browserErrors }, null, 2));
  console.log(JSON.stringify({ event: "case-completed", ...summary }));
  results.push(summary);
}

let nextCase = 0;
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextCase < selected.length) await runCase(selected[nextCase++]);
  }));
} finally { await browser.close(); }
const summary = { ...config, endedAt: new Date().toISOString(), results,
  counts: Object.fromEntries(["PASS", "FAIL", "CAPABILITY_GAP", "FIXTURE_READY"].map(status => [status, results.filter(item => item.status === status).length])) };
await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ event: "suite-completed", output, counts: summary.counts }));
if (results.some(result => result.status === "FAIL")) process.exitCode = 1;
