# PVO Format Note 0.1-prototype

## 1. Purpose

A Playable Video Object (PVO) is a standard MP4 plus a declarative interaction manifest. A normal player plays the base video. A PVO-aware player also displays timed UI and runs safe, inspectable actions.

This prototype is creator-authored. It intentionally excludes signatures, viewer layers, embedded asset packs, and multiplayer.

## 2. Container

The PVO manifest is stored in a top-level ISO Base Media File Format `uuid` box appended after the existing MP4 boxes.

| Field | Value |
| --- | --- |
| box type | `uuid` |
| user type | `5a125a6e-8c7a-4ba8-9dd9-5e449a275056` |
| payload subtype | four bytes: `pvom` |
| remaining payload | UTF-8 JSON manifest |
| maximum manifest | 2 MiB |

A writer must replace existing PVO manifest boxes when re-exporting. A reader uses the last valid PVO manifest when more than one is encountered. Unknown MP4 boxes are preserved byte-for-byte. A size-zero final MP4 box is rewritten with an explicit size before PVO data is appended.

The recommended filename is `name.pvo.mp4`. This keeps ordinary operating-system and browser MP4 handling intact.

## 3. Manifest

The top-level object contains:

- `spec_version`: currently `0.1-prototype`.
- `initial_scene`: scene to enter first.
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

Components may also carry an optional sanitized `html`/`css` presentation plus normalized layout and timing in `presentation`. Semantic fields remain present so a host can replace that presentation with native UI. Choice and form components may preserve authoring routes in `scene_change`.

Choices and forms do not need visual scene connectors. They route by declaring `goto_scene` in their actions.

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
| `custom` | hand a named event to an extended host player |

Every action may have `when`. Conditions read either state (`{"key":"path","is":"left"}`) or a request response (`{"response":"/ok","is":true}`). Supported comparisons are `is`, `not`, `gt`, `gte`, `lt`, `lte`, `in`, and `exists`.

Strings may contain `{state.path}` or `{response.message}` templates. Templates never execute code.

## 4. Playback

The player identifies the scene containing the current video time. It runs `on_enter` when entering a scene and `on_exit` at its end. If no choice or form is waiting and the scene declares `next`, the player seeks to that scene. Otherwise playback pauses.

All alternate footage lives in the same MP4. Branching is a seek, so no media network or secondary video file is required.

## 5. Network boundary

`request` is deliberately generic. The format does not know about Stripe, products, bookings, quizzes, or databases. A creator supplies a URL, request data, and response conditions; the creator's server supplies the meaning.

A player should limit requests to `allowed_domains`, expose network activity to the viewer, and preserve an explicit error path.

## 6. Security

- Manifests are data, never executable code.
- Presentation HTML and CSS are untrusted data. Players must sanitize them again, block scripts and network-loading CSS, and isolate rendered UI from the host page.
- `open_url` requires viewer confirmation.
- Manifest size is capped at 2 MiB in this prototype.
- Player implementations should validate all references, scene ranges, and normalized coordinates before playback.

Cryptographic signing and a creator trust model are future format work, not implied by this prototype.
