import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/assistant/native/context.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function project() {
  const clip = { id: 1, url: "blob:http://localhost/private-footage", srcDur: 12, in: 2, out: 10,
    speed: 2, zoom: 1, mirror: false, width: 320, height: 240, fit: "contain", color: "#000" };
  const scene = { id: "main", name: "Main", parent: null, muted: false, sound: 0,
    clips: [clip, { ...clip, id: 2, url: "blob:http://localhost/second-private-footage" }],
    audioClips: [{ id: 3, name: "Voiceover", url: "blob:http://localhost/private-voiceover",
      srcDur: 15, in: 1, out: 9, speed: 1, start: 2, muted: false }], texts: [], components: [] };
  return { currentSceneId: "main", ratio: "16:9", allowedDomains: [], scenes: [scene] };
}

test("speech evidence survives overlay, framing and editor-context changes while visual evidence expires", () => {
  const original = project();
  const audio = { scope: "audio", fingerprint: api.nativeAudioFingerprint(original), content: "The spoken punchline." };
  const visual = { scope: "project", fingerprint: api.nativeProjectFingerprint(original), content: "The sampled frame." };
  for (const change of [
    value => { value.scenes[0].texts.push({ id: 10, text: "Guess the punchline", start: 0, end: 5, x: 50, y: 50 }); },
    value => { value.scenes[0].components.push({ id: "choice", at: 0, dur: 5, fields: { prompt: "Guess" } }); },
    value => { value.ratio = "9:16"; },
    value => { value.scenes[0].clips[0].zoom = 2; },
    value => { value.scenes[0].clips[0].fit = "cover"; },
    value => { value.scenes[0].clips[0].mirror = true; },
    value => { value.scenes[0].clips[0].color = "#f00"; },
    value => { value.scenes[0].name = "Renamed"; },
    value => { value.scenes[0].audioClips[0].name = "Renamed voiceover"; },
    value => { value.scenes[0].musicGain = 0.4; value.scenes[0].sound = 2; },
    value => { value.currentSceneId = "another-scene"; },
    value => { value.allowedDomains.push("example.com"); },
  ]) {
    const edited = structuredClone(original);
    change(edited);
    assert.equal(api.nativeEvidenceMatchesProject(audio, edited), true, "Unchanged authored speech stays usable");
    assert.equal(api.nativeEvidenceMatchesProject(visual, edited), false, "Full-project evidence keeps its original invalidation rule");
  }
});

test("audio evidence expires when clip sources, sequence, trim, speed or audibility changes", () => {
  const original = project();
  const token = api.nativeAudioFingerprint(original);
  for (const change of [
    value => { value.scenes[0].id = "renamed-id"; },
    value => { value.scenes[0].muted = true; },
    value => { value.scenes[0].clipGain = 0.4; },
    value => { value.scenes[0].clips[0].url = "blob:http://localhost/replacement"; },
    value => { value.scenes[0].clips[0].srcDur = 20; },
    value => { value.scenes[0].clips[0].in = 3; },
    value => { value.scenes[0].clips[0].out = 9; },
    value => { value.scenes[0].clips[0].speed = 1; },
    value => { value.scenes[0].clips[0].audioDetached = true; },
    value => { value.scenes[0].clips.reverse(); },
    value => { value.scenes[0].clips.pop(); },
    value => { value.scenes.push({ ...structuredClone(value.scenes[0]), id: "second-scene" }); },
  ]) {
    const edited = structuredClone(original);
    change(edited);
    assert.notEqual(api.nativeAudioFingerprint(edited), token);
  }
});

test("independent audio identity, timing, rate and audibility participate in evidence validity", () => {
  const original = project();
  const token = api.nativeAudioFingerprint(original);
  for (const changes of [
    { url: "blob:http://localhost/replacement" }, { srcDur: 20 }, { in: 2 }, { out: 10 },
    { start: 3 }, { speed: 2 }, { muted: true }, { gain: 0.4 },
  ]) {
    const edited = structuredClone(original);
    Object.assign(edited.scenes[0].audioClips[0], changes);
    assert.notEqual(api.nativeAudioFingerprint(edited), token, JSON.stringify(changes));
  }
  const deleted = structuredClone(original);
  deleted.scenes[0].audioClips = [];
  assert.notEqual(api.nativeAudioFingerprint(deleted), token);
});

test("audio evidence normalizes authored defaults and exposes only an opaque fingerprint", () => {
  const original = project();
  const explicit = structuredClone(original);
  explicit.scenes[0].clipGain = 1;
  explicit.scenes[0].clips[0].audioDetached = false;
  explicit.scenes[0].audioClips[0].gain = 1;
  const token = api.nativeAudioFingerprint(original);
  assert.equal(api.nativeAudioFingerprint(explicit), token);
  assert.match(token, /^\d+-[\da-f]+-[\da-f]+$/);
  assert.doesNotMatch(token, /blob:|localhost|private|footage|voiceover/);
  assert.equal(api.nativeEvidenceFingerprint(original, "audio"), token);
  assert.equal(api.nativeEvidenceFingerprint(original, "project"), api.nativeProjectFingerprint(original));
  assert.doesNotMatch(JSON.stringify(api.nativeProjectContext(original, 0)), /blob:|localhost|private-footage|private-voiceover/);
});
