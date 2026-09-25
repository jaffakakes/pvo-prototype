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

### Components

- `tooltip`: a short label, normally positioned from the hotspot that revealed it.
- `card`: title, text, and optional action buttons.
- `choice`: two or more options; every option owns an action or action list.
- `form`: typed fields and an `on_submit` action list.

Components may also carry optional sanitized `html`/`css` presentation plus normalized layout, clip ID, and clip-local timing in `presentation`. Semantic fields remain present so a host can replace that presentation with native UI. Choice and form components may preserve a binary `scene_change` with one `true` timeline, one `false` timeline, and `executeAt: "end"`.

Selecting a choice or submitting a form records its result without switching immediately. At the end of that component's presentation range, playback opens the matching outcome timeline. If no result has been supplied, playback pauses and keeps the component visible. The True and False routes use distinct timeline IDs; those timelines may intentionally reuse the same media asset.

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

On the main timeline, a choice or form with routing continues playing after an early answer and branches only when that component layer ends. If the layer ends before an answer is supplied, the player pauses there. Once answered, it loads only the matching outcome timeline. The unselected outcome remains packaged but is not played. Playback ends when that selected branch ends.

Restart clears recorded answers and returns to the first clip of the main timeline.

## 5. Network boundary

`request` is deliberately generic. The format does not know about Stripe, products, bookings, quizzes, or databases. A creator supplies a URL, request data, and response conditions; the creator's server supplies the meaning.

A player should limit requests to `allowed_domains`, expose network activity to the viewer, and preserve an explicit error path.

## 6. Security

- Manifests are data, never executable code.
- Presentation HTML and CSS are untrusted data. Players must sanitize them again, block scripts and network-loading CSS, and isolate rendered UI from the host page.
- `open_url` requires viewer confirmation.
- Manifest size is capped at 2 MiB and the package header at 4 MiB in this prototype.
- Player implementations should validate all references, scene ranges, and normalized coordinates before playback.

Cryptographic signing and a creator trust model are future format work, not implied by this prototype.
