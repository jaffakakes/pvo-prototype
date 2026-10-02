import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { verifyRealQuizPlayback } from "./quizPlayback.mjs";

// Replays a saved, successful REAL model edit for interaction-only verification.
// The semantic project is immutable: only expired browser blob URLs are rebound.
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...values] = argument.replace(/^--/, "").split("=");
  return [key, values.join("=")];
}));
assert(options.step && options.output, "Pass --step=/absolute/step-1.json and --output=/absolute/directory");
const stepPath = path.resolve(options.step);
const sourceBytes = await readFile(stepPath);
const original = JSON.parse(sourceBytes);
assert.equal(original.failure, null, "Only a successfully completed actual model request can be replayed");
assert.deepEqual(original.assertionFailures, [], "The model edit must have passed semantic and Undo assertions");
assert(original.turns.length > 0 && original.turns.every(turn => turn.response), "The source artifact must contain actual successful native replies");
const result = JSON.parse(await readFile(path.join(path.dirname(stepPath), "result.json"), "utf8"));
const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
const events = [], browserErrors = [], unexpectedRequests = [];
page.on("pageerror", error => browserErrors.push(error.message));
await context.route("**/api/assistant/**", route => {
  unexpectedRequests.push(new URL(route.request().url()).pathname);
  return route.abort("blockedbyclient");
});
const report = { sourceStep: stepPath, sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  sourceRequestStartedAt: original.startedAt, originalPrompt: original.prompt,
  mediaPath: result.media.path, mediaSha256: createHash("sha256").update(await readFile(result.media.path)).digest("hex"),
  startedAt: new Date().toISOString(), newModelCalls: 0, rebinding: "Only existing fixture blob URLs; authored content, operations, timing and response policies are unchanged.",
  status: "running", events, browserErrors, unexpectedRequests };
const started = performance.now();
try {
  await page.goto(options["editor-url"] || "http://127.0.0.1:5198/", { waitUntil: "networkidle" });
  await page.route("**/__replay_media.mp4", route => route.fulfill({ path: result.media.path, contentType: "video/mp4" }));
  const mediaUrl = await page.evaluate(async () => {
    const response = await fetch("/__replay_media.mp4");
    if (!response.ok) throw new Error("The original fixture media is unavailable");
    return URL.createObjectURL(await response.blob());
  });
  const rebind = project => {
    const copy = structuredClone(project);
    for (const scene of copy.scenes) for (const layer of [...scene.clips, ...(scene.audioClips ?? [])]) {
      if (layer.url) {
        assert.equal(layer.url, result.media.url, "Replay supports only the original recorded fixture media");
        layer.url = mediaUrl;
      }
    }
    return copy;
  };
  const before = rebind(original.before), after = rebind(original.after);
  await page.evaluate(async ({ before, after }) => {
    const { useCapture } = await import("/src/state/captureStore.ts");
    const { initial } = await import("/src/state/project/initial.ts");
    const { restore } = await import("/src/state/project/history.ts");
    const clean = initial();
    useCapture.setState({ ...clean, ...restore(clean, after), screen: "editor", past: [before], future: [] });
  }, { before, after });
  await verifyRealQuizPlayback({ page, steps: [{ ...original, before, after }], directory: output,
    record: event => events.push({ atMs: Math.round(performance.now() - started), ...event }) });
  assert.deepEqual(unexpectedRequests, [], "Interaction replay must make no assistant/provider requests");
  assert.deepEqual(browserErrors, []);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  report.durationMs = Math.round(performance.now() - started);
  await page.screenshot({ path: path.join(output, "final.png") }).catch(() => {});
  await writeFile(path.join(output, "browser-verification.json"), JSON.stringify(report, null, 2));
  const summary = { status: report.status, sourceCase: result.id, sourceStep: stepPath,
    sourceSha256: report.sourceSha256, mediaSha256: report.mediaSha256,
    noNewAiCalls: true, assistantRequests: unexpectedRequests, durationMs: report.durationMs,
    rebinding: report.rebinding, error: report.error,
    viewports: [1440, 390].map(width => ({ width, events: events.filter(event => event.viewport.width === width)
      .map(event => ({ phase: event.phase, answer: event.answer, sceneTime: event.state.t,
        mediaTime: event.state.video?.time, paused: event.state.video?.paused,
        holdingId: event.state.holdingId, playing: event.state.playing,
        visibleButtons: event.visibleButtons, nativePauseTime: event.state.rawPauseEvents.at(-1)?.time })) })),
  };
  await writeFile(path.join(output, "result.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify({ status: report.status, output, durationMs: report.durationMs, error: report.error, newModelCalls: 0 }));
