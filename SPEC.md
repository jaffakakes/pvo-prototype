# PVO Format Note 0.1-prototype

## 1. Purpose

A Playable Video Object (PVO) is a self-contained package containing media assets plus a declarative interaction manifest. A PVO-aware player follows its main timeline, displays timed UI, evaluates choices, and plays only the selected branch.

This prototype is creator-authored. It intentionally excludes signatures, viewer layers, and multiplayer.

## 2. Container

The current PVO file begins with a fixed package prefix and JSON header, followed by the unchanged bytes of every referenced media asset.

| Field | Value |
| --- | --- |
| magic | eight bytes: `PVOPACK1` |
| header length | unsigned 32-bit big-endian integer |
| header | UTF-8 JSON manifest and asset index |
| payload | original media assets at indexed byte ranges |
| maximum manifest | 2 MiB |

Asset index entries declare a stable ID, name, MIME type, payload-relative byte offset, and byte length. Asset byte ranges must be valid and may not overlap. Packaging does not transcode or join the source videos.

The filename is `name.pvo` and the MIME type is `application/vnd.pvo`.

The SDK continues to read and write the earlier MP4/MOV `uuid`-box prototype for compatibility. New editor exports use only the self-contained `.pvo` package.

## 3. Manifest

The top-level object contains:

- `spec_version`: currently `0.1-prototype`.
- `media`: packaged media IDs, names, and MIME types.
- `poster`: an optional WebP or PNG asset ID and selected time in seconds on the initial scene. The asset is separate from video media and is packaged in the same file.
- `playback`: the main timeline plus each possible outcome timeline.
- `initial_scene`: scene entered first.
- `canvas`: the authored display ratio and its numeric width/height relationship.
- `scenes`: named `[start, end]` time ranges in seconds.
- `components`: UI definitions with a stable ID and one of four kinds.
- `hotspots`: normalized `[0, 1]` rectangles, time bounds, and actions.
- `triggers`: actions that fire at declared absolute video times.
- `state.initial`: optional initial key-value state.
- `allowed_domains`: optional allow-list for `request` actions.
- `restyle_capture`: optional editor presentation metadata, including per-scene layer order and animation.

Coordinates are relative to the actual video content, not to any letterbox area added by a player.

### Scene tree

Scenes may include `parent`, a scene ID or `null` for the root. Parent metadata is either declared on every scene or omitted on every scene. When present, exactly one scene is the root, and parent references must exist and form no cycles. Parent ownership describes the tree and can guide prefetching; it does not restrict which scene an explicit action may target.

Restyle uses `main` as its permanent root. Interactive export includes a separate video asset and timeline for every scene, along with its parent. Every scene needs a clip before export; the editor reports empty branches instead of dropping them. Flat video export renders only Main.

### Components

- `tooltip`: a short label, normally positioned from the hotspot that revealed it.
- `card`: title, text, and optional action buttons.
- `choice`: two or more options; every option owns an action or action list.
- `form`: typed fields and an `on_submit` action list.

Components may also carry optional sanitized `html`/`css` presentation plus normalized layout, clip ID, and clip-local timing in `presentation`. Semantic fields remain present so a host can replace that presentation with native UI. The Restyle editor does not expose raw HTML/CSS/JavaScript authoring: its Advanced route packages PVO Structure, Style and Logic source, and compiled presentation is a generated artifact. A Restyle custom component must include its PVO language sources; a compiled presentation alone is invalid.

Every card, choice, and form component declares a timed `presentation` and a `response_policy`:

| Field | Value | Meaning |
| --- | --- | --- |
| `dispatch` | `interaction` | Run the selected button, option, or submit action when the viewer responds. |
| `dispatch` | `layer_end` | Remember the response locally and run its action when `presentation.end` is reached. |
| `unanswered` | `continue` | Cross `presentation.end` without running an action when nobody responded. |
| `unanswered` | `pause` | Pause at `presentation.end` and keep the component available until the viewer responds. |

The two fields are independent. With `layer_end`, the latest valid response before the boundary is the one dispatched. A response supplied after playback has paused dispatches immediately because the layer boundary has already been reached. No empty or made-up response is dispatched when nobody responds. A request begins only when its response action is dispatched. Tooltip components do not accept a response policy because they have no viewer action.

Responding does not itself mean branching. The selected action may update state, make a request, continue, seek to another time, or open another scene. Only an explicit `seek` or `goto_scene` changes playback.

Restyle components keep their center in `restyle_capture.x` and `.y` (canvas percentages). Optional `scaleX` and `scaleY` independently scale the original rendered width and height, including content, around that center. An absent axis inherits `scale`; absent uniform scale defaults to one. Each factor is bounded to 0.25–3. The reference editor and player share these rules for visual and code-owned components. The standard `presentation` rectangle carries bounded fallback dimensions for other hosts.

Optional `restyle_capture.width` and `.height` set explicit canvas-pixel dimensions (1–16384 px) before uniform `scale`. Authoring pixels use a fixed 1080px short edge: portrait 9:16 is 1080 × 1920, landscape 16:9 is 1920 × 1080. Each explicit dimension overrides that axis's legacy scale factor. The reference hosts measure untransformed content and scale it to these dimensions, retaining the authored size across viewport and content changes. Absent pixel dimensions retain the original scale-based behavior. This coordinate system is independent of preview zoom and export quality.

### Layer animation

Restyle presentation metadata has `version: 1` and `scene_layers`, an object keyed by existing scene IDs. Each scene entry carries `order` (back-to-front layer keys such as `video`, `text:7` and `component:choice-1`) and `texts`. Optional `clips` and `audioClips` record animated media layers, and `musicAnimation` records scene music automation. A media entry is exactly `{ id, start, in, out, speed, animation }`: `start` is its scene placement, `in`/`out` are original source seconds, `out > in >= 0`, and `speed > 0`. These entries describe animation clocks; they do not add playback clips or select assets.

Components store curves at `components[].restyle_capture.animation`; text and media entries store their own `animation`. All use one shape:

```json
{
  "tracks": {
    "x": [
      { "time": 0, "value": 0, "easing": "linear" },
      { "time": 2, "value": 20, "easing": "ease-out" }
    ],
    "opacity": [
      { "time": 0, "value": 0, "easing": "linear" },
      { "time": 1, "value": 1, "easing": "linear" }
    ]
  }
}
```

| Property | Meaning | Neutral value | Bounds |
| --- | --- | --- | --- |
| `x`, `y` | Offsets from the authored center, in canvas width/height percentage points | 0 | −1000 to 1000 |
| `scaleX`, `scaleY` | Multipliers of authored dimensions, around the center | 1 | 0 to 10 |
| `rotation` | Additional clockwise degrees around the center | 0 | −36000 to 36000 |
| `opacity` | Multiplier of authored opacity | 1 | 0 to 1 |
| `gain` | Multiplier of authored volume | 1 | 0 to 1 |

Video supports every property. Text and components support visual properties only; audio and music support only `gain`. Missing curves use neutral values. Curve arrays contain 1–4096 keys, with at most 16384 keys per layer. Every key has exactly `time`, `value` and `easing`; unknown properties are invalid. Times must be finite, strictly increasing, unique and within 0–86400 seconds, and values must be finite and within their property's bounds.

Easing belongs to the outgoing interval. For normalized interval progress `u`, `linear` uses `u`, `ease-in` uses `u²`, `ease-out` uses `1 − (1 − u)²`, and `ease-in-out` uses `2u²` before the midpoint and `1 − (−2u + 2)² / 2` afterward. `hold` keeps the left key's value until the next key's timestamp. Evaluation holds endpoint values outside a curve's range; a single key therefore holds its value throughout the layer. Curves do not extend a layer's authored lifetime.

| Layer | Curve clock at scene time `t` |
| --- | --- |
| Video / independent audio | `in + (t - start) * speed` in original source seconds |
| Text | `t - text.start` |
| Component | `t - component.restyle_capture.at` |
| Music | `t` |

Source-clock keys may lie outside the current trim; preserving them keeps motion aligned after trimming, splitting or changing speed. Moving text or a component moves its local curve with it. The authoring API accepts scene times and converts them to this stored clock once. See the [shared runtime contract](packages/pvo-animation/README.md) and [manifest schema](packages/pvo-sdk/pvo-manifest.schema.json).

Editor checkpoints may additionally retain validated `animationTracking` provenance on a visual layer: the actual measured observation, requested subject, density, source fingerprint, generated key identities and original camera/visibility curves needed for a safe refit. This authoring-only metadata is excluded from exported `restyle_capture` and from model project context. The numeric `animation` curves above remain the only runtime motion contract.

Restyle PVO export renders each scene's static crop, zoom, mirror and audio mix into its packaged media. Video, text and component visual animation remains live in the player, so an animated video can reveal layers beneath it. Exported gain curves describe the authored mix and must not be applied again to that already mixed scene audio. Flat video export instead bakes video/text animation into Main's media and excludes interactive components.

### Actions

| Type | Effect |
| --- | --- |
| `show` / `hide` | change component visibility |
| `set` | write state or add to a numeric value |
| `goto_scene` | seek to a named scene start |
| `seek` | seek to a scene or absolute time |
| `request` | make an HTTP request and run `on_success` or `on_error` |
| `open_url` | ask before opening an external URL |
| `chain` | execute actions in order |
| `branch` | execute the first matching case |
| `custom` | hand a named event to an extended host player; optional `into` stores its returned result in state |

Every action may have `when`. Conditions read either state (`{"key":"path","is":"left"}`) or a request response (`{"response":"/ok","is":true}`). Supported comparisons are `is`, `not`, `gt`, `gte`, `lt`, `lte`, `in`, and `exists`.

Strings may contain `{state.path}` or `{response.message}` templates. Templates never execute code.

A tooltip (called a Note in Restyle) may use a state template in `text`, for example `"Recommendation: {state.responses.choice-1.title}"`. A visible tooltip is resolved again whenever runtime state changes, so either a GET or POST response stored with `into` can update it. Missing or null values render as empty text.

## 4. Playback

The player starts with `playback.initial_timeline`. It advances through that timeline's clip list, loading each clip's packaged asset and respecting its source start/end range.

For a component with `response_policy`, the player dispatches its authored action at the declared time and applies the unanswered rule at the component layer's end. A deferred response is local data until dispatch: it does not call Logic, start a request, update shared runtime state, seek, or open a scene early. If the dispatched action enters another timeline, that selected timeline plays to its end; nothing automatically returns to the timeline that routed there.

Restart clears captured responses and runtime state, then returns to the first clip of the main timeline.

Restyle packages carry `restyle_capture` for presentation: canvas positions, sizes, looks, animation, text layers and each scene's layer order. Playback routes remain standard actions. Restyle exports response timing and unanswered behavior through the standard `response_policy`; routes remain explicit actions.

A Restyle service connection uses `components[].restyle_capture.service_connection`, containing exactly `origin`, `serviceId`, `releaseId`, `operation`, `event`, `target` and `input`. Its [closed descriptor and submission contract](packages/pvo-assistant/attachments/README.md) belongs to the service attachment package. It carries no creator account, credential, private receipt or readiness permission. The Restyle player admits it against the actual compiled/declared control and request before host-owned invocation; ordinary SDK validation alone is insufficient. The service still checks live activation and input on each call. Playback destinations remain the component's standard request success/error actions. Normal editor projection and activation-on-delivery are pending roadmap 1E.06–09.


At a component's layer end, the reference editor and player require its animated center to be on canvas and its animation opacity and both scale factors to exceed `0.000001` before pausing for an unanswered response. A component below video is eligible when the video has faded or its transformed opaque rectangle no longer covers that center. Coverage accounts for translation, scaling, rotation and canvas aspect ratio. This is a conservative center test, not pixel-level testing of every button, transparent region or other overlay. Motion updates retain component DOM and sandbox state. Zero-opacity or collapsed components cannot receive input.

These availability rules prevent an invisible component from trapping playback; they do not rewrite its response policy. A response captured before the boundary still dispatches its authored action at `layer_end`, even if the component has become invisible. A failed deferred response releases an invisible retry hold while retaining its failure feedback.

## 5. Network boundary

`request` is deliberately generic. The format does not know about Stripe, products, bookings, quizzes, or databases. A creator supplies a URL, request data, and response conditions; the creator's server supplies the meaning.

A player must send requests only to exact hosts declared in `allowed_domains`, expose network activity to the viewer, and preserve an explicit error path. An absent or empty allow-list authorizes no requests. A failed or offline request runs `on_error` when present; otherwise it has no effect and is not queued for later. The reference editor and player store submitted Form values at `state.form.<component-id>.<field-name>` and component request responses at `state.responses.<component-id>` for later templates.

## 6. Security

- Manifests are data, never executable code.
- Presentation HTML and CSS, including generated presentation, are untrusted data. Players must sanitize them again, block scripts and network-loading CSS, and isolate rendered UI from the host page. Restyle PVO Logic is declarative, not JavaScript; its grammar and host checks are described in the [PVO language guide](docs/language/README.md).
- `open_url` requires viewer confirmation.
- Manifest size is capped at 2 MiB and the package header at 4 MiB in this prototype.
- Player implementations should validate all references, scene ranges, and normalized coordinates before playback.

Cryptographic signing and a creator trust model are future format work, not implied by this prototype.

### Downloaded fonts

The editor keeps a downloaded font with its authored component (`font`) or text style (`fontAsset`). A font contains a stable ID, display family, HTTPS source and licence URLs, the original licence and copyright text (up to 30,000 characters), and up to 32 embedded WOFF2, WOFF, TTF or OTF faces with weight, normal/italic style and optional Unicode ranges. Total decoded bytes are limited to 1 MiB per family. Project snapshots and history retain those bytes independently of the browser font library.

Interactive exports replace each applied font with `{ "asset_id": "fonts/pvo-…json" }` in `restyle_capture.font` or the scene text's `style.fontAsset`. Each unique font is stored once as an `application/vnd.pvo.font+json` package asset. Font bytes never inflate the bounded manifest. The player validates and restores these assets before playback; no font download is required to view an export. Flat video export waits for the fonts before drawing text.

Downloaded fonts are host data, separate from PVO Style. Native text and controls use the applied family; isolated renderers receive validated binary `FontFace` objects from the host. Existing generated CSS restrictions and `font-src 'none'` remain in force.
