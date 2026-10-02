import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/infrastructure/assistant/media/frames.ts';
  export * from './editor/src/infrastructure/assistant/media/audio.ts';
  export * from './editor/src/infrastructure/assistant/media/transcript.ts';
  export * from './editor/src/infrastructure/assistant/media/wav.ts';
` }, bundle: true, write: false, format: "iife", globalName: "inspection", platform: "browser" }).outputFiles[0].text;
let transcriptBytes = 0;
const server = createServer(async (request, response) => {
  if (request.url === "/inspection.js") {
    response.setHeader("Content-Type", "application/javascript"); response.end(bundle); return;
  }
  if (request.url === "/api/assistant/transcribe") {
    for await (const chunk of request) transcriptBytes += chunk.length;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ text: "Hello there", segments: [{ start: 0.1, end: 0.6, text: "Hello there" }] })); return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><meta charset="utf-8"><script src="/inspection.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean);
let executablePath;
for (const path of candidates) {
  try { await access(path); executablePath = path; break; } catch { /* Try the next installed browser. */ }
}
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const api = window.inspection;
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const sourceAudio = new AudioContext();
    const audioOutput = sourceAudio.createMediaStreamDestination();
    const tone = sourceAudio.createOscillator();
    tone.frequency.value = 440;
    tone.connect(audioOutput);
    const audioTrack = audioOutput.stream.getAudioTracks()[0];
    stream.addTrack(audioTrack);
    await sourceAudio.resume();
    tone.start();
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    const started = performance.now();
    await new Promise(resolve => {
      const paint = () => {
        const elapsed = (performance.now() - started) / 1000;
        if (elapsed >= 1.2 && audioTrack.readyState === "live") {
          tone.stop();
          audioTrack.stop();
        }
        context.fillStyle = elapsed < 1 ? "#ff0000" : elapsed < 2 ? "#00ff00" : "#0000ff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (elapsed >= 3.1) resolve(); else requestAnimationFrame(paint);
      };
      paint();
    });
    await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    stream.getTracks().forEach(track => track.stop());
    tone.disconnect();
    await sourceAudio.close();
    const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    const base = { id: 1, url, srcDur: 3.1, in: 0.25, out: 2.25, speed: 2, color: "#ffff00", zoom: 1,
      mirror: false, width: 160, height: 90, fit: "contain" };
    const scene = { id: "main", name: "Main", parent: null, clips: [base, { ...base, id: 2, in: 0, out: 1, speed: 1 },
      { ...base, id: 3, url: null, in: 0, out: 1, speed: 1 }], texts: [], components: [], sound: 0, muted: false };
    const project = { scenes: [scene], ratio: "16:9" };
    const createElement = document.createElement.bind(document);
    const decoders = [];
    document.createElement = (...args) => {
      const element = createElement(...args);
      if (args[0] === "video") decoders.push(element);
      return element;
    };
    try {
      const observed = await api.inspectAssistantFrames(project, { kind: "frames", sceneId: "main", start: 0, end: 3, count: 6 });
      const colors = [];
      for (const frame of observed.frames) {
        const image = new Image(); image.src = frame.dataUrl; await image.decode();
        context.drawImage(image, 0, 0, 160, 90);
        colors.push(Array.from(context.getImageData(80, 45, 1, 1).data).slice(0, 3));
      }
      const compressedBytes = await (await fetch(url)).arrayBuffer();
      const decoder = new OfflineAudioContext(1, 16000, 16000);
      const compressedAudio = await decoder.decodeAudioData(compressedBytes);
      const shortAudioProject = { scenes: [{ ...scene, clips: [{ ...base, in: 0, out: 3, speed: 1 }] }], ratio: "16:9" };
      const shortAudio = await api.extractAssistantAudio(shortAudioProject, { kind: "transcript", sceneId: "main", start: 0, end: 3 });
      const shortAudioView = new DataView(shortAudio);
      let compressedPeak = 0;
      let silentTailPeak = 0;
      for (let offset = 44; offset < shortAudioView.byteLength; offset += 2) {
        const amplitude = Math.abs(shortAudioView.getInt16(offset, true));
        compressedPeak = Math.max(compressedPeak, amplitude);
        if (offset >= 44 + 2 * 16000 * 2) silentTailPeak = Math.max(silentTailPeak, amplitude);
      }
      const silentTail = await api.extractAssistantAudio(shortAudioProject, { kind: "transcript", sceneId: "main", start: 2, end: 3 });
      const samples = Float32Array.from({ length: 8 * 16000 }, (_, index) => Math.sin(index / 16000 * 440 * 2 * Math.PI));
      const audioUrl = URL.createObjectURL(new Blob([api.monoWav(samples, 16000)], { type: "audio/wav" }));
      try {
        const audioProject = { scenes: [{ ...scene, clips: [{ ...base, url: audioUrl, srcDur: 8, in: 2, out: 6, speed: 2 }], clipGain: 0.25 }], ratio: "16:9" };
        const request = { kind: "transcript", sceneId: "main", start: 0.5, end: 1.5 };
        const wav = await api.extractAssistantAudio(audioProject, request);
        const view = new DataView(wav);
        let max = 0;
        let crossings = 0;
        let previous = 0;
        for (let offset = 44; offset < view.byteLength; offset += 2) {
          const sample = view.getInt16(offset, true);
          max = Math.max(max, Math.abs(sample));
          if (previous < 0 && sample >= 0) crossings++;
          previous = sample;
        }
        const transcript = await api.transcribeAssistantAudio(audioProject, request);
        const controller = new AbortController();
        const cancelled = api.inspectAssistantFrames(project, { kind: "frames", sceneId: "main", start: 0, end: 3, count: 6 }, { signal: controller.signal });
        controller.abort();
        let cancellation;
        try { await cancelled; } catch (error) { cancellation = error.name; }
        return { frames: observed.frames.map(frame => [frame.sceneTime, frame.clipId, frame.sourceTime]), colors,
          decodersReleased: decoders.every(video => !video.hasAttribute("src") && video.paused),
          wavBytes: wav.byteLength, max, crossings, transcript, cancellation,
          compressedDuration: compressedAudio.duration, compressedPeak, silentTailPeak,
          shortAudioBytes: shortAudio.byteLength, silentTail };
      } finally { URL.revokeObjectURL(audioUrl); }
    } finally { document.createElement = createElement; URL.revokeObjectURL(url); }
  });
  assert.deepEqual(result.frames, [[0.25, 1, 0.75], [0.75, 1, 1.75], [1.25, 2, 0.25], [1.75, 2, 0.75], [2.25, 3, 0.25], [2.75, 3, 0.75]]);
  assert(result.colors[0][0] > 220 && result.colors[0][1] < 30, `Trim/speed should sample the red source interval: ${JSON.stringify(result.colors)}`);
  assert(result.colors[1][1] > 220 && result.colors[1][0] < 30, "Later source timestamp should sample green");
  assert(result.colors[2][0] > 220 && result.colors[3][0] > 220, "Next clip must return to its own source interval");
  assert(result.colors[4][0] > 80 && result.colors[4][1] > 80 && result.colors[4][2] < 50, "Synthetic clip should render its authored gradient");
  assert.equal(result.decodersReleased, true);
  assert.equal(result.cancellation, "AbortError");
  assert.equal(result.wavBytes, 32044);
  assert(result.max >= 8100 && result.max <= 8250, "Authored gain must affect the extracted audio");
  assert(result.crossings > 870 && result.crossings < 890, "Audio source time must advance at authored 2x speed");
  assert.deepEqual(result.transcript.segments, [{ start: 0.6, end: 1.1, text: "Hello there" }]);
  assert.equal(transcriptBytes, 32044);
  assert(result.compressedDuration < 2, `Fixture audio must end before its video: ${result.compressedDuration}`);
  assert.equal(result.shortAudioBytes, 96044);
  assert(result.compressedPeak > 1000, "Compressed audio remains audible before its track ends");
  assert.equal(result.silentTailPeak, 0, "The video-only tail remains silent in the full-range WAV");
  assert.equal(result.silentTail, null, "A range entirely after the audio track ends needs no transcription");
  console.log("Assistant media: real decoded frame timestamps/colors, synthetic clips, PCM timing/gain, transcript mapping and decoder cleanup passed.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
