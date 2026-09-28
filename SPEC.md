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
- `initial_scene`: compatibility scene entered first.
- `canvas`: the authored display ratio and its numeric width/height relationship.
- `scenes`: named `[start, end]` time ranges in seconds.
- `components`: UI definitions with a stable ID and one of four kinds.
- `hotspots`: normalized `[0, 1]` rectangles, time bounds, and actions.
- `triggers`: actions that fire at declared absolute video times.
- `state.initial`: optional initial key-value state.
- `allowed_domains`: optional allow-list for `request` actions.

Coordinates are relative to the actual video content, not to any letterbox area added by a player.

### Scene tree

Scenes may include `parent`, a scene ID or `null` for the root. When tree metadata is present, every scene declares its parent, exactly one scene is the root, and parent references must exist and form no cycles. Legacy manifests omit `parent` on every scene and retain their flat-scene behavior. Parent ownership describes the tree and can guide prefetching; it does not restrict which scene an explicit action may target.

Restyle uses `main` as its permanent root. Interactive export includes a separate video asset and timeline for every scene, along with its parent. Every scene needs a clip before export; the editor reports empty branches instead of dropping them. Flat video export renders only Main.

### Components

- `tooltip`: a short label, normally positioned from the hotspot that revealed it.
- `card`: title, text, and optional action buttons.
- `choice`: two or more options; every option owns an action or action list.
- `form`: typed fields and an `on_submit` action list.

Components may also carry optional sanitized `html`/`css` presentation plus normalized layout, clip ID, and clip-local timing in `presentation`. Semantic fields remain present so a host can replace that presentation with native UI. The Restyle editor does not expose raw HTML/CSS/JavaScript authoring: its Advanced route packages PVO Structure, Style and Logic source, and compiled presentation is a generated artifact. The current Restyle player requires those language sources for a Restyle custom component; legacy Restyle code assets without them are rejected. Choice and form components may preserve a binary `scene_change` with one `true` timeline, one `false` timeline, and `executeAt: "end"`.

Selecting a choice executes that option's action list; submitting a form executes `on_submit`. Neither interaction creates an implicit branch. Only when the optional `scene_change` is enabled does the player also record a binary result for an end-of-layer branch. In that case, an early answer does not switch timelines immediately: at the end of the component's presentation range, playback opens the matching outcome timeline. If no result has been supplied by then, playback pauses and keeps the component visible. The True and False routes use distinct timeline IDs; those timelines may intentionally reuse the same media asset.

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

For forms, a host can return `true` or `false` from a `custom` submit action and store it through `into`. The end-of-layer branch then reads that recorded result exactly like a choice answer.

Strings may contain `{state.path}` or `{response.message}` templates. Templates never execute code.

## 4. Playback

The player starts with `playback.initial_timeline`. It advances through that timeline's clip list, loading each clip's packaged asset and respecting its source start/end range.

On any timeline, a choice or form with `scene_change` routing continues playing after an early answer and branches only when that component layer ends. If the layer ends before an answer is supplied, the player pauses there with the component visible. Once answered, it loads only the matching outcome timeline. The unselected outcome remains packaged but is not played. Playback ends when that selected branch ends; nothing returns to the timeline that routed there. Without `scene_change`, the option or submit action list runs without an automatic timeline switch; an explicit `goto_scene` or `seek` action can still route playback, and a branch entered that way ends the same way.

Restart clears recorded answers and returns to the first clip of the main timeline.

Restyle packages carry `restyle_capture` for layout only: canvas positions, sizes, looks, text layers and each scene's layer order. They declare no playback rules of their own. A Restyle choice with **Branch at layer end** exports the standard `scene_change` above; every other route is an explicit action. A component behind the opaque video in the layer order cannot wait for a tap, so the player does not pause for it.

## 5. Network boundary

`request` is deliberately generic. The format does not know about Stripe, products, bookings, quizzes, or databases. A creator supplies a URL, request data, and response conditions; the creator's server supplies the meaning.

A player must send requests only to exact hosts declared in `allowed_domains`, expose network activity to the viewer, and preserve an explicit error path. An absent or empty allow-list authorizes no requests. A failed or offline request runs `on_error` when present; otherwise it has no effect and is not queued for later. The reference editor and player store submitted Form values at `state.form.<component-id>.<field-name>` for request templates.

## 6. Security

- Manifests are data, never executable code.
- Presentation HTML and CSS, including generated presentation, are untrusted data. Players must sanitize them again, block scripts and network-loading CSS, and isolate rendered UI from the host page. Restyle PVO Logic is declarative, not JavaScript; its grammar and host checks are described in the [PVO language guide](docs/engineering/pvo-language.md).
- `open_url` requires viewer confirmation.
- Manifest size is capped at 2 MiB and the package header at 4 MiB in this prototype.
- Player implementations should validate all references, scene ranges, and normalized coordinates before playback.

Cryptographic signing and a creator trust model are future format work, not implied by this prototype.
