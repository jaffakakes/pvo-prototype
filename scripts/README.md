# Build and verification tools

Run npm commands from the repository root. Scripts are grouped by their job:

```text
scripts/
  build/              Static site, Rust/WASM, sample and share-demo preparation
  dev/                Static development server
  checks/
    javascript.mjs    Source JavaScript syntax checks (excluding generated code)
    run.mjs           Select and run a browser suite or named checks
    editor/           Recording, authoring, layers, requests and export
    player/           Playback and action workflows against a running player
    language/         Self-contained compiler and source-player browser fixtures
    runtime/          Isolated renderer/worker checks
    helpers/          Fixture-server source-module discovery
```

## Build and local checks

| Command | Purpose |
| --- | --- |
| `npm run build` | Build Rust/WASM, copy static module trees, and build the editor into `dist/`. Replaces existing output. |
| `npm run build:docs` | Build only the PVO documentation into `docs-dist/docs/`, separate from the application. |
| `npm run dev:worker` | Serve the built application with the Cloudflare Worker locally. |
| `npm run deploy` | Build, deploy with Wrangler, verify served assets, and broadcast the release to connected editors; requires Cloudflare authentication. See the [release channel setup](../docs/engineering/cloudflare-publishing.md#live-beta-release-notifications). |
| `node scripts/build/editor-icons.mjs` | Regenerate the editor's Home Screen icons from its existing brand mark; needs installed Chrome. |
| `npm run build:language` | Generate only `packages/pvo-language/pkg/` with wasm-pack. |
| `npm run dev` | Full build, then serve `dist/` on port 4173 (`PVO_PORT` overrides it). |
| `npm run dev:editor` | Build the language, then run Vite on port 5173. |
| `npm run check` | Check JavaScript syntax, dependency boundaries and Node behavior tests. |
| `npm run check:architecture` | Check domain/state/presentation, editor/player and shared-package import directions. This does not replace responsibility, lifecycle or cycle review. |
| `npm run check:editor` | Check editor TypeScript. |
| `npm run check:language` | Run native Rust tests with the checked-in Cargo lockfile. |
| `npm run check:language:format` | Verify Rust formatting. |
| `npm run build:sample` | Regenerate the example PVO-in-MP4 fixture. |

Rust, the `wasm32-unknown-unknown` target, and wasm-pack are needed for language builds. The browser bridge imports generated `pkg/` bindings; build them before editor builds or tests that bundle the editor. `target/`, `pkg/`, and `dist/` are output, not source to edit.

The application build excludes demo and documentation pages and demo media. To prepare development/demo fixtures, use `node scripts/build/share-demo.mjs <source.pvo> <output.pvo> <preview.mp4>`; it requires ffmpeg. See the [Cloudflare publishing guide](../docs/engineering/cloudflare-publishing.md) for optional R2/D1 and creator sign-in configuration.

## Browser suites

`npm run check:browser -- editor audio-extraction` verifies explicit audio extraction, independent movement/trimming, undo/cancel, original-audio muting, saved media, mobile deletion, and the audible timing of exported video including audio beyond the last video frame. It requires Vite, Chrome and `ffmpeg` on PATH; the test generates its own tone video and inspects the encoded audio.

The checks use `playwright-core` with an installed Chrome. Set `CHROME_PATH` when the browser is not at the Windows default path. This does not install a browser.

`npm run check:browser -- editor clip-adjustments` checks speed/playhead constraints, grouped crop undo, mirror, sound labels and text timing after the sheet/rule extraction. It requires Vite for its project fixture. The camera-startup suite explicitly uses a phone viewport so it exercises the camera rather than the desktop studio.

| Command | Prerequisites |
| --- | --- |
| `npm run check:browser:language` | Generated WASM and Chrome; compiler/player fixture servers start and stop themselves. |
| `npm run check:browser:runtime` | Chrome; the isolation fixture starts its own server. |
| `npm run check:browser:editor` | Editor Vite server and Chrome. Some older integration checks also open the player on the same origin; use the focused checks when validating only one feature. |
| `npm run check:browser:player` | Built static player server and Chrome. |

Choose focused checks with `npm run check:browser -- editor pvo-language pvo-export pvo-requests` or `npm run check:browser -- player playback actions`. Names match files in the suite, without `.mjs`.

`npm run check:browser -- editor playhead-drag` checks direct mobile playhead dragging with touch input, preview seeking, release and cancellation, timeline swiping, bounds, keyboard access, viewport resizing, playback pausing and text timing selection. It uses public UI and also runs against built or deployed output through `EDITOR_URL`.

`npm run check:browser -- editor product-home export-share` verifies the existing mobile camera home, retained drafts across reloads, automatic export downloads and exact-file optional sharing. Both run against Vite or a built Worker URL through `EDITOR_URL`. Publishing responses and native share are isolated browser fixtures; these checks do not verify live Google credentials or remote R2. `npm run check:browser -- player published` verifies both published viewer formats with local fixtures. Backend integration coverage uses real local Worker/D1/R2 execution via `node --test tests/publishing-server*.test.mjs`.

For editor layout changes, `npm run check:browser -- editor sheet-dock timeline-resize panel-safe-area editor-viewport-fit playhead-picker` checks contained panels, touch/keyboard resizing, retained drafts and playback, nested cancellation, timeline restoration and phone-sized layouts. Timeline resizing also checks fixed row sizes, scrolling, layer interaction and independent panel sizes. `panel-safe-area` uses Chrome's safe-area emulation to check that fullscreen and near-fullscreen panel handles remain reachable in portrait and landscape; it requires a Chrome version supporting `Emulation.setSafeAreaInsetsOverride`. These browser checks do not replace a real-device keyboard and gesture check.

`npm run check:browser -- editor no-code-workspace` checks the component sheet's same-height timeline swap, visible player clamp, compact header, pull-down dismissal, scrolling, Try restoration and keyboard viewport choreography at 320, 390 and 430 px. Its keyboard signal is simulated; a real device is still needed to verify the OS keyboard itself. Older component checks that require fullscreen sheets or an Accept timing button describe the previous editing flow.

`npm run check:browser -- editor advanced-workspace` checks 80% code expansion at three phone and two desktop sizes, hidden outer navigation, retained source DOM/draft/caret, restored panel size, and a single floating orb through mocked HTTP proposals and real compilation/Keep. It also checks safe-area insets and a simulated phone keyboard viewport. It requires Vite and Chrome; keyboard simulation does not replace a device check.

`npm run check:browser -- editor pvo-formatting` checks automatic formatting on opening valid compact source, leaving a changed field, and receiving AI changes. Card and Form fixtures verify identical compiler output, preserved text and request literals, untouched focused text and invalid drafts, no Format button, and single-step Undo/Redo. It requires Vite, generated WASM and Chrome; only the AI HTTP response is mocked.

`npm run check:browser -- editor no-code-action-editing` covers direct PVO response-route edits in older forms, retained field identities and undo, action edits beside invalid source drafts, inline feedback for uneditable Logic, timeline-picker failures and scene-creation preflight.

`npm run check:browser -- editor request-separation` checks local form playback actions without network traffic, direct PVO request authoring in Advanced, retained requests when Advanced is hidden, typed submission and undoable replacement with a local action. It requires Vite and Chrome. Form domain/runtime tests also verify local answer state and native exported-player behavior, including compatibility with older destination-required forms.

`npm run check:browser -- editor scene-tree` covers contextual scene navigation, the full tree confined to the timeline, phone-width overflow, scene management and outcome destinations. It runs against Vite or a production editor URL. Scene domain, persistence, return playback and manifest rules also have Node regression tests.

Editor scripts honor `EDITOR_URL`, then the legacy `RESTYLE_EDITOR_URL`, then `http://127.0.0.1:5173/`. Player scripts honor `PVO_PLAYER_URL`, defaulting to `http://127.0.0.1:4173/player/`. Self-contained language checks use temporary local ports and need neither development server.

`npm run check:browser -- editor preview-gestures` sends real multi-touch input to text and component overlays, checks gesture history/cancellation and two-to-one-finger transitions, and verifies that page pinching stays disabled while sheet scrolling and Try mode remain functional. It uses only public UI and also runs against a production editor URL.

`npm run check:browser -- editor component-size` checks desktop/tablet Width and Height pixel fields for all four component types, independent axes, undo/redo, cancelled and bounded numeric input, original-size reset, stable canvas dimensions across viewport sizes, mobile control preservation, code-owned resizing and exported player dimensions. It requires Vite for project and player fixtures. Run `preview-gestures` alongside it when changing scaling rules.

`npm run check:browser -- editor orb-assistant assistant-voice pvo-overlay-bounds` checks the [orb assistant](../docs/engineering/orb-assistant.md), proposal comparison/history, responsive controls, hold/release input and fitted PVO preview bounds. These checks mock only the `/api/assistant` HTTP boundary with explicit proposal/error fixtures and keep real compilation and review. Voice also uses mocked recognition with real browser gestures; it does not verify device microphones or a live AI service. The orb workflow and bounds checks run against a production URL; the voice check requires Vite because it also inspects project state.

`npm run check:browser -- editor assistant-logic-mode` verifies that Advanced off still permits custom appearances, blocks advanced logic without changing project/history, preserves one-step Undo/Redo, and rechecks mode changes during inference and review. It requires Vite and mocks only the model HTTP reply; an injected prepared review also exercises the current-switch guard independently of provider policy.

A suite is a collection of existing behavioral checks, not a guarantee that every old workflow has kept pace with product changes. Report individual failures; do not weaken assertions to make a folder move pass. CI currently runs native Rust, format, JavaScript/Node, TypeScript, and production-build checks; browser suites remain explicit local checks.

`npm run check:browser -- editor no-code-components look-contracts component-sync` covers Content/Look/Action, current-wording presets, independent part styles, grouped undo, timeline picking, direct Advanced edits and draft recovery, form destinations, generated appearance compilation and player styles. `component-sync` checks all four component types through mocked HTTP AI proposals, real compilation, Keep, bidirectional content/style/action edits, saved reloads and an actual media export. These checks require the editor Vite server and generated WASM. The companion `no-code-workspace` check verifies the phone sheet and keyboard geometry. Browser keyboard simulation does not replace a real-device OS keyboard check.

`npm run check:browser -- editor notifications` checks the [notification policy](../docs/engineering/notification-policy.md): mobile safe areas, dismissal, pause on hover/focus, brief expiry, deduplication, retained critical issues, busy suppression and reduced motion. It requires Vite for notification fixtures. `orb-assistant` also checks the real unsupported-request notification, preserved input and absence of duplicate inline messages against development or production.

`npm run check:browser -- editor desktop-create` checks the studio at supported landscape sizes, the existing narrow/portrait editor, stable URLs across breakpoints, uploads, ratios, auth dismissal, exact-media recovery, independent local projects, templates and whole-page drops. It runs against Vite or a built beta URL; account availability is mocked.

`npm run check:browser -- editor desktop-editor` checks the approved Library / Player / Inspector / Timeline layout at 1440 × 900, 1280 × 800 and 1024 × 768, the existing narrow/portrait workspace, real sample playback, speed/split history, pixel sizes across viewports and save/reload, assistant placement, Try isolation, export entry and scene navigation. It uses public UI and real local checkpoints, and also runs against built or deployed output through `EDITOR_URL`.
