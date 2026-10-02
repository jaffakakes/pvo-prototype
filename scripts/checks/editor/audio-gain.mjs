import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export { renderCompletedExport } from './editor/src/features/export/exportWorkflow.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export * from './editor/src/state/editing/audioGainCommands.ts';
  export * from './editor/src/infrastructure/projectPersistence/checkpoint.ts';
  export { monoWav } from './editor/src/infrastructure/assistant/media/wav.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" }).outputFiles[0].text;
const server = createServer((request, response) => {
  if (request.url === "/gain.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle); return; }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><meta charset="utf-8"><script type="module">import * as api from "/gain.js"; window.gainCheck = api;</script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  let executablePath;
  for (const path of [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean)) {
    try { await access(path); executablePath = path; break; } catch { /* Try another browser location. */ }
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.gainCheck));
  const result = await page.evaluate(async () => {
    const api = window.gainCheck;
    api.useCapture.setState(api.initial());
    const synthetic = { id: 1, url: null, srcDur: 3, in: 0, out: 3, speed: 1, color: "#4267ff",
      zoom: 1, mirror: false, width: 160, height: 90, fit: "contain" };
    api.useCapture.getState().patch({ screen: "editor", clips: [synthetic], sound: 1, quality: "720p", ratio: "16:9" });
    const state = () => api.useCapture.getState();
    api.setSceneAudioGain("main", "music", 0.5);
    api.setSceneAudioGain("main", "music", 0.25, false);
    const history = state().past.length;
    state().undo();
    const undo = state().scenes[0].musicGain ?? 1;
    state().redo();
    const redo = state().scenes[0].musicGain;
    const stored = api.storeCheckpoint(api.captureCheckpoint(state()), new Map(), 123);
    const restored = api.restoreCheckpoint(JSON.parse(JSON.stringify(stored)), new Map());
    const saved = restored.project.scenes[0].musicGain;
    const decoder = new AudioContext();
    const renderLevels = async project => {
      const rendered = await api.renderCompletedExport({ ...project, quality: "720p", snapshotId: "gain-test" }, "video", () => {});
      try {
        const buffer = await decoder.decodeAudioData(await rendered.artifact.blob.arrayBuffer());
        const data = buffer.getChannelData(0);
        let sum = 0; let count = 0; let peak = 0;
        for (let i = Math.floor(buffer.sampleRate); i < Math.min(data.length, 2.5 * buffer.sampleRate); i++) {
          sum += data[i] ** 2; count++; peak = Math.max(peak, Math.abs(data[i]));
        }
        return { rms: Math.sqrt(sum / count), peak };
      } finally { URL.revokeObjectURL(rendered.url); }
    };
    let audioUrl;
    try {
      const musicQuiet = await renderLevels(restored.project);
      const musicFull = await renderLevels({ ...restored.project, scenes: [{ ...restored.project.scenes[0], musicGain: 1 }] });
      const samples = Float32Array.from({ length: 4 * 16000 }, (_, i) => Math.sin(i / 16000 * 440 * 2 * Math.PI) * 0.4);
      audioUrl = URL.createObjectURL(new Blob([api.monoWav(samples, 16000)], { type: "audio/wav" }));
      state().patch({ sound: 0, audioClips: [{ id: 3, name: "Tone", url: audioUrl, srcDur: 4, in: 0, out: 3, speed: 1, start: 0, muted: false }] });
      api.setAudioClipGain("main", 3, 0.25);
      const audioQuiet = await renderLevels(state());
      api.setAudioClipGain("main", 3, 1);
      const audioFull = await renderLevels(state());
      return { history, undo, redo, saved, musicQuiet, musicFull, audioQuiet, audioFull };
    } finally { if (audioUrl) URL.revokeObjectURL(audioUrl); await decoder.close(); }
  });
  assert.equal(result.history, 1, "A slider gesture should make one undo entry");
  assert.equal(result.undo, 1);
  assert.equal(result.redo, 0.25);
  assert.equal(result.saved, 0.25);
  for (const kind of ["music", "audio"]) {
    // Music has an envelope; peak amplitude is independent of the recorder's startup beat offset.
    const measure = kind === "music" ? "peak" : "rms";
    const ratio = result[`${kind}Quiet`][measure] / result[`${kind}Full`][measure];
    assert(result[`${kind}Full`].rms > 0.03, `${kind} baseline must contain real audio`);
    assert(ratio > 0.2 && ratio < 0.3, `${kind} 25% gain must reduce exported amplitude: ${JSON.stringify(result)}`);
  }
  console.log(`Audio gain: real music/extracted-audio exports, grouped undo/redo and checkpoint reopening passed. Ratios music=${(result.musicQuiet.peak / result.musicFull.peak).toFixed(3)}, extracted=${(result.audioQuiet.rms / result.audioFull.rms).toFixed(3)}.`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
