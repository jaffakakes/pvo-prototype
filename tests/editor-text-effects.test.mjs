import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { evaluateAnimation, parseAnimation } from "../packages/pvo-animation/index.js";

const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export * from './editor/src/domain/text/effects.ts';
  export { useCapture } from './editor/src/state/captureStore.ts';
  export { initial } from './editor/src/state/project/initial.ts';
` }, bundle: true, write: false, format: "esm", platform: "browser" });
const { textEffectAnimation, matchingTextEffect, useCapture, initial } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("text effects produce portable, ordered tracks within even short text durations", () => {
  for (const duration of [0.05, 0.1, 3, 600]) {
    for (const effect of ["fadeIn", "fadeOut", "slideRight", "pop", "jitter", "flicker"]) {
      const animation = textEffectAnimation(effect, duration);
      assert.deepEqual(parseAnimation(animation), animation);
      assert.equal(matchingTextEffect(structuredClone(animation), duration), effect);
      for (const frames of Object.values(animation.tracks)) assert(frames.at(-1).time <= duration);
    }
  }
});

test("text effects enter, exit and settle on the layer's local clock", () => {
  const fadeIn = textEffectAnimation("fadeIn", 3);
  assert.equal(evaluateAnimation(fadeIn, 0).opacity, 0);
  assert.equal(evaluateAnimation(fadeIn, 3).opacity, 1);
  const fadeOut = textEffectAnimation("fadeOut", 3);
  assert.equal(evaluateAnimation(fadeOut, 0).opacity, 1);
  assert.equal(evaluateAnimation(fadeOut, 3).opacity, 0);
  assert.equal(evaluateAnimation(textEffectAnimation("slideRight", 3), 3).x, 0);
  assert.equal(evaluateAnimation(textEffectAnimation("jitter", 3), 3).y, 0);
  assert.equal(evaluateAnimation(textEffectAnimation("pop", 3), 3).scaleX, 1);
  const flicker = textEffectAnimation("flicker", 3);
  assert.equal(evaluateAnimation(flicker, 0.2).opacity, 0);
  assert.equal(evaluateAnimation(flicker, 3).opacity, 1);
  assert.equal(textEffectAnimation("none", 3), undefined);
  assert.equal(matchingTextEffect({ tracks: { rotation: [{ time: 0, value: 30, easing: "linear" }] } }, 3), null);
  assert.throws(() => textEffectAnimation("pop", 0), /positive duration/);
});

test("a new text and its effect share one undo step and survive redo", () => {
  useCapture.setState(initial());
  const state = useCapture.getState();
  const id = state.addText("Text effects");
  const animation = textEffectAnimation("pop", 3);
  useCapture.getState().updateText(id, { animation }, false);
  assert.equal(useCapture.getState().past.length, 1);
  assert.deepEqual(useCapture.getState().texts[0].animation, animation);
  useCapture.getState().undo();
  assert.equal(useCapture.getState().texts.length, 0);
  useCapture.getState().redo();
  assert.deepEqual(useCapture.getState().texts[0].animation, animation);
  useCapture.getState().updateText(id, { animation: textEffectAnimation("none", 3) });
  assert.equal(useCapture.getState().texts[0].animation, undefined);
  useCapture.getState().undo();
  assert.deepEqual(useCapture.getState().texts[0].animation, animation);
});
