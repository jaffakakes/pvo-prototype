import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { acceptanceFixture } from "../assistant-acceptance/fixtures.mjs";
import { verifyWorkflow } from "../assistant-acceptance/assertions.mjs";
import { installStudyHarness } from "./browserHarness.mjs";
import { installStudyTransport } from "./transport.mjs";
import { loadStudyMedia } from "./mediaFixture.mjs";

const json = value => JSON.stringify(value, null, 2);

function workCounts(steps) {
  const observations = steps.flatMap(step => step.observations);
  return {
    nativeTurns: steps.reduce((sum, step) => sum + step.turns.length, 0),
    canonicalObservationExecutions: observations.length,
    transcriptExecutions: observations.filter(item => item.request.kind === "transcript").length,
    requestedAudioSeconds: observations.filter(item => item.request.kind === "transcript")
      .reduce((sum, item) => sum + item.request.end - item.request.start, 0),
    frameExecutions: observations.filter(item => item.request.kind === "frames").length,
    requestedFrames: observations.filter(item => item.request.kind === "frames")
      .reduce((sum, item) => sum + item.request.count, 0),
    preparationAttempts: steps.reduce((sum, step) => sum + step.preparations.length, 0),
    modelStageMs: steps.flatMap(step => step.turns).reduce((sum, item) => sum + item.durationMs, 0),
    observationStageMs: observations.reduce((sum, item) => sum + item.durationMs, 0),
    preparationStageMs: steps.flatMap(step => step.preparations).reduce((sum, item) => sum + item.durationMs, 0),
  };
}

/** Each arm receives a fresh browser/profile, project, conversation and Undo history. */
export async function runTrial({ browser, definition, trial, config, lookup }) {
  const started = performance.now();
  const directory = path.join(config.output, trial.trialId);
  await mkdir(directory);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const network = [], browserErrors = [], failures = [], steps = [], evidenceLookups = [];
  let media = null, initial = null, dryProbe = null;
  page.on("pageerror", error => browserErrors.push(error.message));
  await installStudyTransport(context, config.studyUrl, trial, network, { dryRun: config.dryRun, phase: config.phase });
  if (config.phase === "frozen") await page.exposeFunction("__studyObserve", async (project, request) => {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const result = await lookup(project, request);
    evidenceLookups.push({ request, startedAt, durationMs: Math.round(performance.now() - start),
      resultKind: result.kind, ...(result.kind === "unavailable" ? { message: result.message } : {}) });
    return result;
  });
  console.log(JSON.stringify({ event: "trial-started", ...trial }));
  try {
    await page.goto(config.editorUrl, { waitUntil: "networkidle", timeout: 30000 });
    const mediaPath = definition.mediaPath ?? path.join(config.root, "share/assets/preview.mp4");
    media = { ...(await loadStudyMedia(page, mediaPath)), path: mediaPath };
    const fixture = (definition.fixture ?? acceptanceFixture)(media);
    initial = await page.evaluate(installStudyHarness, {
      root: config.root, fixture, advanced: definition.advanced ?? false,
      timeoutMs: config.timeoutMs, seedComponents: definition.seedComponents ?? true, trial, phase: config.phase,
    });
    await writeFile(path.join(directory, "initial.json"), json(initial));
    if (config.dryRun) {
      const menuChecks = [];
      if (lookup) for (const request of definition.frozenMenu ?? []) {
        const result = await lookup(initial.project, request);
        assert.notEqual(result.kind, "unavailable", `Registered fixture menu misses frozen evidence: ${JSON.stringify(request)}`);
        menuChecks.push({ request, resultKind: result.kind });
      }
      dryProbe = { ...(await page.evaluate(() => window.__nativeStudy.checkNativeAtomicity())), menuChecks };
    }
    if (!config.dryRun) {
      for (const [index, expectation] of definition.steps.entries()) {
        console.log(JSON.stringify({ event: "step-started", trialId: trial.trialId, step: index + 1, prompt: expectation.prompt }));
        const step = await page.evaluate(input => window.__nativeStudy.run(input), {
          prompt: expectation.prompt, mode: expectation.mode ?? "edit",
        });
        step.expectation = { outcome: expectation.expect, maxObservations: expectation.maxObservations };
        step.assertionFailures = verifyWorkflow(step, expectation);
        steps.push(step);
        try { await expectation.verify?.(step, { steps, initial }); }
        catch (error) { step.assertionFailures.push({ assertion: "scenario postconditions", message: error.message }); }
        failures.push(...step.assertionFailures.map(failure => ({ step: index + 1, ...failure })));
        await writeFile(path.join(directory, `step-${index + 1}.json`), json(step));
        console.log(JSON.stringify({ event: "step-completed", trialId: trial.trialId, step: index + 1,
          endToEndMs: step.endToEndMs, failures: step.assertionFailures, failure: step.failure }));
        if (step.failure || step.assertionFailures.length) break;
      }
    }
  } catch (error) {
    failures.push({ assertion: "test infrastructure", message: error.stack ?? error.message });
  } finally {
    if (browserErrors.length) failures.push({ assertion: "browser errors", message: browserErrors.join("\n") });
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => {});
    await context.close();
  }
  const status = failures.length ? "FAIL" : config.dryRun ? "FIXTURE_READY" : "PASS";
  const result = { ...trial, phase: config.phase, status, title: definition.title,
    initialFingerprint: initial?.fingerprint ?? null,
    firstPlanningBaselineHash: steps[0]?.turns[0]?.telemetry?.find(event => event.kind === "planning")?.baselineInputHash ?? null,
    wallMs: Math.round(performance.now() - started),
    requestMs: steps.reduce((sum, step) => sum + step.endToEndMs, 0),
    completedSteps: steps.length, plannedSteps: definition.steps.length,
    plannedPrompts: definition.steps.map(step => step.prompt),
    counts: workCounts(steps), failures, artifactDirectory: directory };
  await writeFile(path.join(directory, "result.json"), json({ ...result, media, network, browserErrors, evidenceLookups, dryProbe }));
  console.log(JSON.stringify({ event: "trial-completed", ...result }));
  return result;
}
