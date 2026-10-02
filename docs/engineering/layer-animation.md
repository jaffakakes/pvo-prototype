# Layer animation

Keyframes belong to every layer: video, text, visual and authored PVO components, extracted audio and music. Manual controls and assistant operations use the same domain rules and saved curves.

## Authoring

Select a layer and open its keyframe controls. The desktop timeline exposes property lanes or a combined lane; the mobile sheet edits a whole visual transform at the playhead. Position pairs X/Y, Scale writes both axes, and Rotate, Opacity and Volume address their corresponding curves. Volume is separate from a video's whole visual transform. The controls display layer-local time while shared commands accept scene seconds. Add a diamond or change a value, move the playhead, then add another to animate between them. Easing controls the selected key's outgoing interval. Commands pause playback and use normal Undo/Redo.

Inside keyframe authoring, stage drags and supported pinch gestures auto-key the current transform. Motion paths and optional dots show its trajectory. Outside this mode, ordinary base-geometry editing retains its existing behavior. Gesture previews create no history entries; release commits one Undo, cancellation restores the prior curves, and an unchanged gesture adds no history. Additions snap to a 0.05-second layer-local grid. A moved key stays at least 0.1 seconds from its neighbours; if no legal span exists, it stays in place. A single key holds throughout the layer, and endpoint values hold beyond the first and last key.

For a fade, set Opacity to 0% at the layer's start and 100% one second later. For a slide, set Position X to 40% and then 60% at the destination time. Position fields show absolute stage percentages; saved X/Y curves remain offsets from base geometry. Scale is a uniform factor, while Opacity and Volume display percentages: 100% is stored as `1`. Existing independent scale axes remain intact until an explicit uniform-scale edit.

## Assistant requests

Use the existing request box for instructions such as “Fade this title in over the first second,” “Move this card to the right between 2 and 4 seconds,” or “Fade the music out over the final two seconds.” The assistant can set, remove or clear keyframes for every layer kind. Ordinary authored motion uses those commands directly; following a moving subject requires measured object tracking.

Native `animation.set` replaces the named property curves and preserves other properties. `animation.remove` removes one scene-time key, and `animation.clear` removes one property or the selected layer's animation. The assistant prepares changes privately, verifies the resulting candidate and applies the completed request as one Undo step. It must use real created IDs in a subsequent round when creating and then animating a new layer. Cancelled, invalid or stale requests do not apply their candidate.

## Object tracking

Video, text and components expose object-following controls. Pick the subject in the video; assistant requests can also identify a subject with a text description. The editor reads native service status before exposing manual Follow controls. When object tracking is unavailable, new Follow controls stay hidden and Re-track is disabled, while existing tracked keys can still be re-fitted or detached locally. Tracking shows progress and supports cancellation; a validated result becomes ordinary editable keyframes in one Undo step. A project change during inspection prevents the old result from being applied. Generated keys carry tracking provenance; changing density re-fits cached measurements, Re-track requests fresh evidence, and Detach removes provenance while keeping editable motion.

For a text or component layer, tracking preserves its initial separation from the measured anchor, adding any explicitly requested offset. For the selected source video, tracking instead reframes the camera to keep the subject at canvas center plus the chosen offset. It preserves the clip's scale, rotation, opacity and gain. Cached camera refits retain the original pre-tracking motion so correction is never applied twice. Audio and music have no spatial tracking controls. An assistant request such as “Make this label follow the car” uses the same measurement and conversion rules.

The browser samples video-only frames with its actual fit, zoom, mirror and existing motion; authored text and components are excluded. The configured SAM 3.1 service returns timestamped bounding boxes. The editor validates their geometry and source identity before generating any curves. Provider configuration and operation are documented in the [SAM service guide](../../scripts/dev/sam31/README.md); an unavailable service disables tracking while ordinary keyframes remain usable.

Current limits are explicit:

- One source clip and at most ten scene seconds per request, sampled at 15 fps with both endpoints, at most 151 frames and a 640px long edge. The target layer must span the entire requested interval. Sampling can miss fast motion or brief occlusion.
- Boxes use normalized canvas centers. At least two visible samples with confidence at least `0.25` are required to establish a track; one detected frame alone cannot apply an animation. Ambiguous selection, no confident samples or an object that was found but could not be followed produces an error instead of a guessed path.
- Lost text/component tracks hold the last position and hide the layer until reliable measurements return. Camera tracks hold their last correction and keep the footage visible. Neither interpolates an invented path through a missing interval.
- Generated position keys default to one-second intervals with both endpoints. Density choices of 0.5, 1 or 2 seconds re-fit stored measurements in one Undo without a GPU request. Extra keys retain measured loss/reappearance boundaries. This readable density can approximate fast motion; it is not frame-perfect tracking. A resulting curve may contain at most 120 keys, including retained surrounding keys; complex tracks fail rather than silently dropping points.
- A missing interval conflicts with an existing overlay opacity curve and is rejected. A density refit may replace its own unmodified generated visibility curve, but never a subsequently edited opacity curve. A partial replacement through an existing eased position interval is also rejected because splitting that curve would change its surrounding motion. Track a suitable shorter section or explicitly adjust the conflicting animation first.
- Tracking replaces X/Y only inside its observed interval, preserves surrounding animation and retains other properties. Source timing, footage, geometry or canvas-ratio changes invalidate measured boxes. In particular, camera-follow changes the inspected source motion, so subsequent following operations need fresh measurements; unrelated overlay edits do not invalidate that video evidence.

The native `animation.follow` operation references a completed observation ID registered in the current task. The model cannot supply invented positions or reuse an old chat ID as authority. Editor-only `animationTracking` metadata retains the actual observation, selection, density, source fingerprint and generated key identities. Checkpoints deep-copy and validate this data; trusted media-address remapping keeps already-fresh evidence usable after reload. Source edits require Re-track. Moving/removing generated keys updates provenance, and removing all generated position keys removes it. Raw measurements are excluded from model project context and published PVO manifests. Fixture tests cover this orchestration independently of real-model tracking quality.

## Contract and ownership

`packages/pvo-animation` validates, clones and evaluates numeric curves without application or browser dependencies. `editor/src/domain/animation` owns layer addresses, clocks, editing, tracking conversion and saved-data validation. State commands integrate history; the assistant calls the same domain rule on its private candidate, verifies the result and commits one Undo step.

The canonical field is `animation: { tracks: { <property>: [{ time, value, easing }] } }`. Scene music uses `musicAnimation` with only `gain`. Times are finite, unique and increasing. Easing is `linear`, `hold`, `ease-in`, `ease-out` or `ease-in-out` and belongs to the interval after that keyframe. Missing properties use neutral values. The [format note](../../SPEC.md#layer-animation) defines numeric bounds, limits and exact interpolation.

| Property | Meaning | Neutral |
| --- | --- | --- |
| `x`, `y` | Canvas width/height percentages added to the authored center | 0 |
| `scaleX`, `scaleY` | Multipliers of authored dimensions | 1 |
| `rotation` | Additional clockwise degrees around the center | 0 |
| `opacity` | Multiplier of authored opacity | 1 |
| `gain` | Multiplier of authored volume | 1 |

Visual layers support all properties except gain; video also supports gain. Extracted audio and music support gain only.

| Layer | Stored clock | Evaluation at scene time `t` |
| --- | --- | --- |
| Video / extracted audio | Original media seconds | `in + (t - layerStart) * speed` |
| Text | Seconds from text start | `t - start` |
| Component | Seconds from component start | `t - at` |
| Music | Scene seconds | `t` |

UI and AI commands accept scene seconds; the domain converts once. Media trim, split and speed retain the source curve. Moving text/components moves their local animation. History deep-copies every curve. Checkpoint and manifest boundaries reject malformed curves before rendering.

## Rendering and export

Preview, frame inspection, flat export and the standalone player share evaluation. Inspection and export share the native canvas painter. Animated components retain their DOM and sandbox so motion does not clear a form or restart its state. Explicit player Restart resets the runtime.

Flat export bakes Main's video/text motion and audio automation into the media. Existing flat export excludes interactive components. PVO export bakes static video crop/zoom/mirror and audio automation; video/text/component visual curves stay live. This preserves layer order when moving or fading video reveals an underlying overlay. Gain metadata is retained for authoring provenance and is not applied twice to exported sound.

PVO stores component animation in `component.restyle_capture.animation`, text animation with each text, and media clocks/curves in `restyle_capture.scene_layers[sceneId].clips` and `.audioClips`; music uses `.musicAnimation`. These are presentation curves, not playback actions. Standard response policy still owns response timing.

Unanswered waits evaluate animation at the exact layer-end boundary. A component with collapsed scale, zero animation opacity or a center outside the canvas cannot cause a pause. Below-video components can become available when the video moves or fades away from their center. This is a conservative center/rectangle test, not a pixel-level check of every control. Captured deferred responses still dispatch their authored actions; an invisible failed-response hold releases without deleting failure feedback. DOM and input state survive ordinary animation and temporary hiding.

## Verification

Node tests cover interpolation, validation, property support, clocks, history, native batches, manifests, tracking evidence freshness, gap handling, bounded simplification and interaction boundaries. Browser checks `keyframes` and `keyframe-rendering` cover responsive controls, real preview/export, paused seeks and retained interactive state. `object-tracking-controls` covers the manual tracking lifecycle with measured-result fixtures; `tracking-capture` checks actual decoding and transformed video-only samples. These fixtures do not establish live SAM detection or point propagation quality. See [browser prerequisites and commands](../../scripts/README.md#browser-suites).
