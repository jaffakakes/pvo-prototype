import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export { runPlaybackFrame } from './editor/src/features/preview/playbackFrame.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { runPlaybackFrame } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("a failed playback frame pauses media and ends Try without escaping", () => {
  const failure = new Error("frame failed");
  let pauses = 0;
  let received = null;
  let ordinaryStops = 0;

  assert.doesNotThrow(() => runPlaybackFrame(
    () => { throw failure; },
    0,
    { pause: () => { pauses += 1; } },
    {
      isTrying: () => true,
      failTry: error => { received = error; },
      stopPlayback: () => { ordinaryStops += 1; },
    },
  ));

  assert.equal(pauses, 1);
  assert.equal(received, failure);
  assert.equal(ordinaryStops, 0);
});

test("a failed ordinary frame pauses media and stops editor playback", () => {
  let pauses = 0;
  let tryFailures = 0;
  let received = null;

  runPlaybackFrame(
    () => { throw new Error("ordinary frame failed"); },
    0,
    { pause: () => { pauses += 1; } },
    {
      isTrying: () => false,
      failTry: () => { tryFailures += 1; },
      stopPlayback: error => { received = error; },
    },
  );

  assert.equal(pauses, 1);
  assert.match(received.message, /ordinary frame failed/);
  assert.equal(tryFailures, 0);
});
