import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/store.ts';
  export { initial } from './editor/src/state/project/initial.ts';
  export * from './editor/src/domain/animation/ducking.ts';
  export * from './editor/src/state/animation/ducking.ts';
  export { evaluateAnimation } from './packages/pvo-animation/index.js';
  export { performNotificationAction } from './editor/src/state/assistant/nativeAppliedNotification.ts';
` ,}, bundle: true, write: false, format: "esm", platform: "browser" ,});
const { useCapture, initial, mkClip, duckAuthoringVolume, duckAudioUnderSpeech,
  evaluateAnimation, DUCKING_GAIN_ERROR, performNotificationAction ,} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const state = () => useCapture.getState();
const key = (time, value, easing = "linear") => ({ time, value, easing });
const base = () => ({ id: "main", name: "Main", parent: null, clips: [mkClip(6, "blob:speech", 0)],
  texts: [], components: [], audioClips: [], muted: false, music: {
    track: 1,
  start: 0,
    duration: 6,
    offset: 0,
    gain: 1,
    animation: { tracks: { gain: [key(0, 0, "ease-out"), key(0.8, 1), key(5, 1, "ease-in"), key(6, 0),] ,} ,} ,
  },});
const multiplier = (time, start, end) => time < start - 0.2 || time > end + 0.35 ? 1
  : time < start ? 1 - (0.6 * (time - start + 0.2) )/ 0.2
    : time <= end ? 0.4 : 0.4 + (0.6 * (time - end) )/ 0.35;

test("speech ducking composes with fades and retains untouched keys/easing", () => {
  const scene = base();
  const next = duckAuthoringVolume(scene, { kind: "music" }, [{ start: 2, end: 3 },]);
  for (const frame of scene.music.animation.tracks.gain)
    assert.deepEqual(next.music.animation.tracks.gain.find((value )=> value.time === frame.time,), frame,);
  for (let time = 0; time <= 6; time += 0.01) {
    const expected = evaluateAnimation(scene.music.animation, time).gain * multiplier(time, 2, 3);
    assert(Math.abs(evaluateAnimation(next.music.animation, time).gain - expected) <= DUCKING_GAIN_ERROR,);
  }
});

test("ducking inside eased fades stays within the documented gain error", () => {
  const scene = base();
  const next = duckAuthoringVolume(scene, { kind: "music" }, [{ start: 0.2, end: 0.4 },]);
  for (let time = 0; time < 6; time += 0.001) {
    const expected = evaluateAnimation(scene.music.animation, time).gain * multiplier(time, 0.2, 0.4);
    assert(Math.abs(evaluateAnimation(next.music.animation, time).gain - expected) <= DUCKING_GAIN_ERROR,
      `Gain at ${time} preserves the fade while ducking speech`,);
  }
  assert.deepEqual(next.music.animation.tracks.gain.find((frame )=> frame.time === 5), scene.music.animation.tracks.gain[2],);
});

test("audio ducking translates scene speech into trimmed accelerated source time", () => {
  const scene = { ...base(), audioClips: [{ id: 7, name: "Music", url: "blob:music", srcDur: 12,
    in: 5, out: 11, speed: 2, start: 1, muted: false ,},] ,};
  const next = duckAuthoringVolume(scene, { kind: "audio", id: 7 }, [{ start: 1.7, end: 2.3 },]);
  const animation = next.audioClips[0].animation;
  assert.equal(evaluateAnimation(animation, 5 + (2 - 1) * 2).gain, 0.4);
  assert.equal(evaluateAnimation(animation, 5).gain, 1);
  assert.equal(evaluateAnimation(animation, 11).gain, 1);
  assert.deepEqual(next.music.animation, scene.music.animation);
  assert.throws(() => duckAuthoringVolume(scene, { kind: "audio", id: 7 }, []), /No speech/,);
});

test("ducking preserves an existing jump instead of smearing it across a ramp", () => {
  const scene = base();
  scene.music.animation = { tracks: { gain: [key(0, 1, "hold"), key(2.5, 0.7), key(6, 0.7)] } , };
  const next = duckAuthoringVolume(scene, { kind: "music" }, [{ start: 2, end: 3 },]);
  assert(Math.abs(evaluateAnimation(next.music.animation, 2.5 - 0.0000001).gain - 0.4,) < DUCKING_GAIN_ERROR,);
  assert(Math.abs(evaluateAnimation(next.music.animation, 2.5).gain - 0.28) < DUCKING_GAIN_ERROR,);
});

function fixture() {
  useCapture.setState(initial());
  const scene = base();
  state().patch({ screen: "editor", scenes: [scene], currentSceneId: "main", past: [], future: [] ,});
}
const transcript = (request )=> ({ kind: "transcript", ...request, text: "Actual speech", segments: [{ start: 2, end: 3, text: "Actual speech" }] ,});

test("speech workflow analyzes the snapshot and commits one guarded Undo receipt", async () => {
  fixture();
  const before = JSON.parse(JSON.stringify(state().scenes));
  const requests = [];
  await duckAudioUnderSpeech({ kind: "music" }, { signal: new AbortController().signal,
    transcribe: async (project, request) => { requests.push({ project, request }); return transcript(request); } ,},);
  assert.equal(requests.length, 1);
  assert.deepEqual([requests[0].request.start, requests[0].request.end], [0, 6],);
  assert.equal(state().past.length, 1);
  assert.equal(performNotificationAction(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(state().scenes)), before);
});

test("cancelled, stale and provider-failed speech analysis never apply edits", async () => {
  for (const failure of ["cancel", "stale", "provider"]) {
    fixture();
    const controller = new AbortController();
    await assert.rejects(duckAudioUnderSpeech({ kind: "music" }, { signal: controller.signal,
      transcribe: async (_project, request) => {
        if (failure === "cancel") controller.abort();
        if (failure === "stale") state().patch({ ratio: "16:9" });
        if (failure === "provider") throw new Error("Provider allowance exhausted");
        return transcript(request);
      } ,},),);
    assert.equal(state().past.length, 0);
    assert.deepEqual(state().scenes[0].music.animation, base().music.animation);
  }
});

test("an audio layer does not use its own vocals as speech evidence", async () => {
  fixture();
  state().patch({ audioClips: [{ id: 7, name: "Music", url: "blob:music", srcDur: 6, in: 0, out: 6, speed: 1, start: 0, muted: false ,},] ,});
  await duckAudioUnderSpeech({ kind: "audio", id: 7 }, { signal: new AbortController().signal,
    transcribe: async (project, request) => {
      assert.equal(project.scenes[0].audioClips.length, 0);
      assert.equal(project.scenes[0].clips[0].url, "blob:speech");
      return transcript(request);
    } ,},);
  assert.equal(state().past.length, 1);
  assert.equal(evaluateAnimation(state().audioClips[0].animation, 2.5).gain, 0.4,);
});
