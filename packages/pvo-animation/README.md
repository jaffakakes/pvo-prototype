# Layer animation

Pure numeric keyframe validation and evaluation shared by the editor, rendered export and standalone player. No DOM, store, media or network dependencies.

```js
const animation = {
  tracks: {
    opacity: [
      { time: 0, value: 0, easing: "linear" },
      { time: 1, value: 1, easing: "linear" },
    ],
  },
};
evaluateAnimation(animation, 0.5).opacity; // 0.5
```

`parseAnimation(value, allowedProperties)` validates and copies curves. `evaluateAnimation(animation, time)` returns every supported numeric property, using neutral defaults for absent tracks. `cloneAnimation` copies all nested keyframes. Consumers validate at ingestion, then evaluate without reparsing every playback frame.

| Property | Meaning | Neutral | Range |
| --- | --- | --- | --- |
| `x`, `y` | Offset from static layer center, in canvas percentage points | 0 | −1000…1000 |
| `scaleX`, `scaleY` | Multiplier of static width/height around the center | 1 | 0…10 |
| `rotation` | Additional clockwise degrees around the center | 0 | −36000…36000 |
| `opacity` | Multiplier of static opacity | 1 | 0…1 |
| `gain` | Multiplier of static audio amplitude | 1 | 0…1 |

Video supports visual properties plus gain. Text and components support visual properties. Independent audio and scene music support gain only. Gain zero is silence; zero scale collapses an axis. No sound or visual content is created by animation.

Each property holds an ordered, unique, nonempty list of `{time,value,easing}`. Easing belongs to the outgoing key: `linear`, `hold`, quadratic `ease-in`, quadratic `ease-out`, or quadratic `ease-in-out`. `hold` stays at the left value until the next key. Evaluation holds the first/last value outside the track range: a single key changes the full layer. Add explicit endpoint keys when preserving earlier/later values. Curves support at most 4096 keys each and 16384 keys per layer.

## Clock contract

- Video clips and independent audio use **original-source seconds**. Evaluate at `sourceIn + (sceneTime - layerStart) * speed`. Trim, split, speed and reorder operations retain the curves; motion stays attached to the original media.
- Text uses seconds relative to `start`; components use seconds relative to `at`. Moving a layer moves its animation with it. Changing an overlay's start also moves its animation origin. End trimming hides the later portion without deleting the curve.
- Scene `musicAnimation` uses scene seconds.

The editor's `domain/animation` converts between those clocks and scene seconds. Manual commands and `animation.set/remove` assistant operations accept **scene seconds**, use the same pure mutation rule, and produce one Undo entry per command or validated assistant batch. `animation.set` replaces only named property curves; `animation.clear` removes one or all curves. Animation is persisted alongside its layer and deep-cloned in project history. Stored curves can extend beyond a trimmed visible range, allowing later extension to recover the motion.

This is animation data, not object detection. A tracking adapter can produce these curves, with explicit hold/visibility keys for gaps; it must not invent continuous tracking through missing evidence.

## Interaction availability

`visualMotionVisible` excludes zero opacity or collapsed axes. Renderers retain the timed component DOM while applying hidden visibility, so an animated form does not lose entered values. A response boundary evaluates motion at its exact end rather than the preceding playback frame. The shared `videoCoversPoint` helper inverts the full-canvas video transform to test occlusion. Unanswered holds conservatively require the animated component's center to remain on canvas and, for a component behind video, to be exposed. This is an anchor test, not a measurement of every button's visible pixels. A captured response still dispatches at its authored layer end; if it fails after becoming invisible, playback releases the otherwise inaccessible retry hold and retains the failure status.

## Measured object tracks

`editor/src/domain/animation/tracking.ts` converts a completed SAM 3.1 observation into this same keyframe format. A label attaches to measured box center/top plus a percentage offset. Following the source clip reframes the camera instead: each sampled offset corrects the measured subject toward canvas center, including its existing visual offset once. Camera gaps hold the last valid position. Label gaps hold position and set visibility to zero until a reliable sample returns.

Position simplification uses at most 0.15 percentage-point interpolation error per axis at the observed samples. Hold boundaries are retained. More than 120 resulting keys per property rejects the track instead of cutting off its tail. Existing rotation, scale and gain remain unchanged. Continuous tracking preserves authored opacity; tracking gaps reject an existing opacity curve rather than erase it. Partial tracking through an existing nonlinear eased position segment also rejects rather than silently changing its earlier motion.

Assistant follow operations reference browser-registered observation IDs, not model-authored coordinates. Source media, timing, transforms and canvas ratio are fingerprinted when the tool runs and checked again during preparation. An unrelated label edit can reuse evidence in the current task, but changing the inspected video invalidates it. Old conversation summaries cannot authorize a new follow operation.
