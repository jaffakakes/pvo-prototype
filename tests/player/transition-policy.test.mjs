import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipEndTransition,
  reachedResponseBoundaries,
  responseBoundaryDecision,
} from "../../player/playback/transition-policy.js";

const choice = (id, end) => ({
  id,
  kind: "choice",
  presentation: { end },
  response_policy: { dispatch: "layer_end", unanswered: "pause" },
});

test("response boundaries preserve authored order, tolerances and already consumed answers", () => {
  const later = choice("later", 8);
  const first = choice("first", 3);
  const sameTime = choice("same-time", 3);
  const consumed = choice("consumed", 1);
  const components = [
    later,
    first,
    sameTime,
    consumed,
    { id: "note", kind: "tooltip" },
  ];
  const handled = new Set([consumed.id]);
  const before = structuredClone(components);
  assert.deepEqual(reachedResponseBoundaries(components, handled, 2.95), []);
  assert.deepEqual(reachedResponseBoundaries(components, handled, 2.97), [
    first,
    sameTime,
  ]);
  assert.deepEqual(reachedResponseBoundaries(components, handled, 9), [
    first,
    sameTime,
    later,
  ]);
  assert.deepEqual(
    components,
    before,
    "Policy must not reorder or change manifest components",
  );
  assert.deepEqual(
    [...handled],
    [consumed.id],
    "The state owner records handled boundaries separately",
  );
});

test("hidden and unanswered unreachable components cannot hold playback, but captured work still dispatches", () => {
  const component = choice("answer", 3);
  const response = { status: "captured" };
  assert.equal(
    responseBoundaryDecision({ component, canReceiveResponse: false }),
    null,
  );
  assert.equal(
    responseBoundaryDecision({ component, canReceiveResponse: true }),
    "wait",
  );
  assert.equal(
    responseBoundaryDecision({
      component,
      response,
      hidden: false,
      canReceiveResponse: false,
    }),
    "dispatch",
  );
  assert.equal(
    responseBoundaryDecision({
      component,
      response,
      hidden: true,
      canReceiveResponse: true,
    }),
    null,
  );
});

test("clip completion respects loading, finished playback, end tolerance and explicit forced completion", () => {
  const playback = {
    clip: { end: 5 },
    mediaTime: 4.95,
    switchingClip: false,
    finished: false,
    currentClipIndex: 0,
    clipCount: 2,
  };
  assert.deepEqual(clipEndTransition(playback), { kind: "none" });
  assert.deepEqual(clipEndTransition({ ...playback, mediaTime: 4.97 }), {
    kind: "next",
    index: 1,
  });
  assert.deepEqual(clipEndTransition({ ...playback, force: true }), {
    kind: "next",
    index: 1,
  });
  assert.deepEqual(
    clipEndTransition({ ...playback, force: true, currentClipIndex: 1 }),
    { kind: "finish" },
  );
  for (const guard of [
    { clip: null },
    { switchingClip: true },
    { finished: true },
  ])
    assert.deepEqual(
      clipEndTransition({ ...playback, force: true, ...guard }),
      { kind: "none" },
    );
});
