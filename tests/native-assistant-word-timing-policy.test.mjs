import assert from "node:assert/strict";
import test from "node:test";
import { validateWordTiming } from "../server/assistant/native/wordTimingPolicy.js";

const clip = (changes = {}) => ({ id: 1, start: 0, end: 10, sourceIn: 2, sourceOut: 22,
  sourceDuration: 30, speed: 2, hasMedia: true, audioDetached: false, ...changes });
const scene = (changes = {}) => ({ muted: false, clipGain: 1, clips: [clip()], audioClips: [], ...changes });
const request = (changes = {}) => ({ kind: "word_timing", sceneId: "main", start: 0, end: 0.5,
  source: { kind: "clip", id: 1 }, text: "want peace", language: "en", ...changes });
const provenance = { method: "forced_alignment", engine: "mfa", version: "3.4.2",
  acousticModel: "english_mfa", dictionary: "english_mfa", language: "en", transcriptVerified: false, refined: true };

test("server rejects alignment of muted, detached, missing or ambiguous source identities", () => {
  for (const value of [scene({ muted: true }), scene({ clipGain: 0 }),
    scene({ clips: [clip({ audioDetached: true })] }), scene({ clips: [clip({ hasMedia: false })] })])
    assert.throws(() => validateWordTiming(value, request()), /audible media/);
  assert.throws(() => validateWordTiming(scene({ clips: [clip(), clip()] }), request()), /one existing source/);
  const audio = { id: 7, start: 0, end: 10, sourceIn: 0, sourceOut: 10, sourceDuration: 10, speed: 1, muted: true, gain: 1 };
  const value = scene({ clips: [clip({ audioDetached: true })], audioClips: [audio] });
  const timing = request({ source: { kind: "audio", id: 7 } });
  assert.throws(() => validateWordTiming(value, timing), /audible media/);
  audio.muted = false; audio.gain = 0;
  assert.throws(() => validateWordTiming(value, timing), /audible media/);
});

test("server rejects audible overlaps but allows muted layers, adjacent cuts and detached audio", () => {
  const audio = { id: 7, start: 0.25, end: 2, sourceIn: 0, sourceOut: 1.75, sourceDuration: 3, speed: 1, muted: false, gain: 1 };
  const value = scene({ audioClips: [audio] });
  assert.throws(() => validateWordTiming(value, request()), /overlapping audible/);
  audio.muted = true;
  validateWordTiming(value, request());
  audio.muted = false; audio.gain = 0;
  validateWordTiming(value, request());
  audio.gain = 1; audio.start = 0.5;
  validateWordTiming(value, request());
  value.clips[0].audioDetached = true;
  validateWordTiming(value, request({ start: 0.5, end: 1, source: { kind: "audio", id: 7 } }));
  value.muted = true;
  validateWordTiming(value, request({ start: 0.5, end: 1, source: { kind: "audio", id: 7 } }));
});

test("server source range tolerance matches the editor rather than admitting millisecond overhangs", () => {
  const value = scene({ clips: [clip({ start: 1, end: 11 })] });
  assert.throws(() => validateWordTiming(value, request({ start: 0.999, end: 1.5 })), /one existing source/);
  assert.throws(() => validateWordTiming(value, request({ start: 10.5, end: 11.001 })), /one existing source/);
  validateWordTiming(value, request({ start: 1 - 0.0000001, end: 1.5 }));
  const slow = scene({ clips: [clip({ sourceIn: 0, sourceOut: 60, sourceDuration: 60, start: 0, end: 240, speed: 0.25 })] });
  validateWordTiming(slow, request({ end: 240 }));
  const fast = scene({ clips: [clip({ sourceIn: 0, sourceOut: 80, sourceDuration: 80, start: 0, end: 20, speed: 4 })] });
  assert.throws(() => validateWordTiming(fast, request({ end: 16 })), /60 seconds/);
});

test("server verifies measured timing against the same source and scene mapping within one microsecond", () => {
  const timing = { ...request(), sourceStart: 2, sourceEnd: 3, provenance,
    words: [{ text: "want", start: 0.1, end: 0.2, sourceStart: 2.2, sourceEnd: 2.4 },
      { text: "peace", start: 0.2, end: 0.4, sourceStart: 2.4, sourceEnd: 2.8 }] };
  validateWordTiming(scene(), timing, true);
  assert.throws(() => validateWordTiming(scene({ muted: true }), timing, true), /audible media/);
  for (const mutate of [
    value => { value.sourceStart += 0.001; },
    value => { value.words[0].start += 0.001; },
    value => { value.words[1].end -= 0.001; },
  ]) {
    const changed = structuredClone(timing); mutate(changed);
    assert.throws(() => validateWordTiming(scene(), changed, true), /different source|do not agree/);
  }
});
