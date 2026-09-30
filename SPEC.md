# PVO Format Note 0.1-prototype

## 1. Purpose

A Playable Video Object (PVO) is a self-contained package containing original video assets plus a declarative interaction manifest. A PVO-aware player follows its main timeline, displays timed UI, evaluates choices, and plays only the selected branch.

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
- `playback`: the main timeline plus each possible outcome timeline.
- `initial_scene`: scene entered first.
- `canvas`: the authored display ratio and its numeric width/height relationship.
- `scenes`: named `[start, end]` time ranges in seconds.
- `components`: UI definitions with a stable ID and one of four kinds.
- `hotspots`: normalized `[0, 1]` rectangles, time bounds, and actions.
- `triggers`: actions that fire at declared absolute video times.
- `state.initial`: optional initial key-value state.
- `allowed_domains`: optional allow-list for `request` actions.

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

Restyle packages carry `restyle_capture` for layout only: canvas positions, sizes, looks, text layers and each scene's layer order. They declare no playback rules of their own. Restyle exports response timing and unanswered behavior through the standard `response_policy`; routes remain explicit actions. A component behind the opaque video in the layer order cannot wait for a tap, so the reference player does not pause for it.

## 5. Network boundary

`request` is deliberately generic. The format does not know about Stripe, products, bookings, quizzes, or databases. A creator supplies a URL, request data, and response conditions; the creator's server supplies the meaning.

A player must send requests only to exact hosts declared in `allowed_domains`, expose network activity to the viewer, and preserve an explicit error path. An absent or empty allow-list authorizes no requests. A failed or offline request runs `on_error` when present; otherwise it has no effect and is not queued for later. The reference editor and player store submitted Form values at `state.form.<component-id>.<field-name>` and component request responses at `state.responses.<component-id>` for later templates.

## 6. Security

- Manifests are data, never executable code.
- Presentation HTML and CSS, including generated presentation, are untrusted data. Players must sanitize them again, block scripts and network-loading CSS, and isolate rendered UI from the host page. Restyle PVO Logic is declarative, not JavaScript; its grammar and host checks are described in the [PVO language guide](docs/engineering/pvo-language.md).
- `open_url` requires viewer confirmation.
- Manifest size is capped at 2 MiB and the package header at 4 MiB in this prototype.
- Player implementations should validate all references, scene ranges, and normalized coordinates before playback.

Cryptographic signing and a creator trust model are future format work, not implied by this prototype.
