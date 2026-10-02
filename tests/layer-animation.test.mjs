import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAnimation, parseAnimation, cloneAnimation, ANIMATION_DEFAULTS } from "../packages/pvo-animation/index.js";

const key = (time, value, easing = "linear") => ({ time, value, easing });

test("shared evaluator holds endpoints, respects each outgoing easing and exact-key transitions", () => {
  assert.deepEqual(evaluateAnimation(undefined, 20), ANIMATION_DEFAULTS);
  for (const [easing, expected] of [["linear", 0.25], ["hold", 0], ["ease-in", 0.0625], ["ease-out", 0.4375], ["ease-in-out", 0.125]]) {
    const animation = parseAnimation({ tracks: { opacity: [key(2, 0, easing), key(6, 1)] } });
    assert.equal(evaluateAnimation(animation, 3).opacity, expected, easing);
    assert.equal(evaluateAnimation(animation, -1).opacity, 0);
    assert.equal(evaluateAnimation(animation, 6).opacity, 1);
    assert.equal(evaluateAnimation(animation, 100).opacity, 1);
  }
  const discontinuous = { tracks: { x: [key(0, 0, "hold"), key(2, 20, "hold"), key(3, 100)] } };
  assert.equal(evaluateAnimation(discontinuous, 1.999).x, 0);
  assert.equal(evaluateAnimation(discontinuous, 2).x, 20);
  assert.equal(evaluateAnimation(discontinuous, 2.999).x, 20, "A lost track interval can hold without inventing movement");
  assert.equal(evaluateAnimation(discontinuous, 3).x, 100);
});

test("a single key holds the whole layer; evaluation and cloning never mutate authored curves", () => {
  const animation = { tracks: { gain: [key(3, 0.4)] } };
  for (const time of [-1, 0, 3, 100]) assert.equal(evaluateAnimation(animation, time).gain, 0.4);
  const copy = cloneAnimation(animation);
  copy.tracks.gain[0].value = 0.8;
  assert.equal(animation.tracks.gain[0].value, 0.4);
  assert.deepEqual(evaluateAnimation(animation, NaN), ANIMATION_DEFAULTS);
});

test("animation validation rejects invalid properties, nonfinite data, duplicates, ordering and unbounded curves", () => {
  for (const frames of [[], [key(0, NaN)], [key(-1, 0)], [key(0, 0), key(0, 1)],
    [key(2, 0), key(1, 1)], [key(0, 1.01)], [key(0, 0, "bounce")],
    [{ ...key(0, 0), script: "alert(1)" }], Array.from({ length: 4097 }, (_, i) => key(i, 0))])
    assert.throws(() => parseAnimation({ tracks: { opacity: frames } }));
  assert.throws(() => parseAnimation({ tracks: { gain: [key(0, 1)] } }, ["x"]), /not supported/);
  assert.throws(() => parseAnimation({ tracks: { blur: [key(0, 1)] } }), /not supported/);
  assert.throws(() => parseAnimation({ tracks: {}, code: "forbidden" }));
  const tracks = Object.fromEntries(["x", "y", "scaleX", "scaleY", "rotation"].map(property =>
    [property, Array.from({ length: 4096 }, (_, i) => key(i, 0))]));
  assert.throws(() => parseAnimation({ tracks }), /16384/);
});
