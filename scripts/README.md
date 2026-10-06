# Build and verification tools

Run npm commands from the repository root. Scripts are grouped by their job:

```text
scripts/
  build/              Static site, Rust/WASM, sample and share-demo preparation
  dev/                Local server, auth, render-jobs/ and reply-boxes/ adapters
  checks/
    javascript.mjs    Source JavaScript syntax checks (excluding generated code)
    dependencies.mjs  Declared import-boundary checks
    formatting.mjs    Pinned Prettier for formatting-scope.json adopted files
    tests.mjs         Recursive Node behavior test discovery
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
| `npm run dev:worker` | Serve the built application with the Cloudflare Worker locally; sign-in still requires a matching HTTPS `PUBLIC_ORIGIN` and Worker bindings. |
| `npm run dev:imessage` | Run the opt-in [Mac iMessage test sender](../docs/engineering/imessage-test.md) against the beta Worker. |
| `npm run deploy` | Build, deploy with Wrangler, verify served assets, and broadcast the release to connected editors; requires Cloudflare authentication. See the [release channel setup](../docs/engineering/cloudflare-publishing.md#live-beta-release-notifications). |
| `npm run deploy:built` | Preserve live immutable editor assets for open sessions, then deploy the already-built output, verify its release and announce it. |
| `node scripts/build/editor-icons.mjs` | Regenerate the editor's Home Screen icons from its existing brand mark; needs installed Chrome. |
| `npm run build:language` | Generate only `packages/pvo-language/pkg/` with wasm-pack. |
| `npm run dev` | Full build, then serve `dist/` on loopback port 4173 (`PVO_PORT` overrides it), including local Google auth routes. |
| `npm run dev:editor` | Build the language, then run Vite on port 5173; Vite alone does not provide Google auth routes. |
| `npm run check` | Check JavaScript syntax, dependency boundaries, adopted-file formatting and Node behavior tests. |
| `npm test` | Recursively run `tests/**/*.test.mjs`, including `tests/sdk/` and `tests/server/`; default concurrency is four files. |
| `npm run format` / `npm run check:format` | Write/check pinned Prettier 3.9.9 formatting for the explicit `scripts/checks/formatting-scope.json` list. |
| `npm run check:architecture` | Check declared domain/state, editor/player, server/dev-to-browser and package-to-consumer import boundaries. Includes `scripts/dev`; shared packages cannot import scripts. |
| `npm run check:editor` | Check editor TypeScript. |
| `npm run check:language` | Run native Rust tests with the checked-in Cargo lockfile. |
| `npm run check:language:format` | Verify Rust formatting. |
| `npm run build:sample` | Regenerate the self-contained example `.pvo` package. |

Pass Node test options with `npm test -- --test-concurrency=2`; use `node --test tests/sdk/*.test.mjs` for the focused SDK suites. Add maintained files to the explicit formatting list as formatting is adopted; `npm run format` does not rewrite unlisted source. The dependency check parses static imports/exports, literal dynamic imports/requires and import types. Neither check proves cohesion, naming quality, lifecycle cleanup, cycle freedom or renderer parity; there is no general-purpose linter.

Rust, the `wasm32-unknown-unknown` target, and wasm-pack are needed for language builds. The browser bridge imports generated `pkg/` bindings; build them before editor builds or tests that bundle the editor. `target/`, `pkg/`, and `dist/` are output, not source to edit.

The application build includes public About, Privacy and Terms pages from [`public/`](../public/) for `https://getrestyle.app`, but excludes demo, PVO documentation pages and demo media. To prepare development/demo fixtures, use `node scripts/build/share-demo.mjs <source.pvo> <output.pvo> <preview.mp4>`; it requires ffmpeg. See the [Cloudflare publishing guide](../docs/engineering/cloudflare-publishing.md) for Google account, D1/R2, DNS verification and OAuth Branding setup.

## Local Google sign-in

`npm run dev` serves the built app at `http://127.0.0.1:4173/` and implements the same `/api/auth/session`, `/api/auth/google/start`, `/api/auth/google/callback` and `/api/auth/logout` contract as the Worker. Create a separate Google OAuth **Web application** client for local development. In Google Cloud, register the exact authorized redirect URI `http://127.0.0.1:4173/api/auth/google/callback`. If `PVO_PORT` changes, register that port's exact callback instead. The local client requests only `openid profile`. See [Google's web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).

Run `mkdir -p .wrangler/local-beta`, then create `.wrangler/local-beta/google-client.json` with the following fields, using your own client details:

```json
{"clientId":"YOUR_LOCAL_WEB_CLIENT_ID","clientSecret":"YOUR_LOCAL_WEB_CLIENT_SECRET"}
```

Make its directory private with `chmod 700 .wrangler/local-beta` and the file private with `chmod 600 .wrangler/local-beta/google-client.json` before starting the server. The server refuses a client file that is readable by other users. The `.wrangler/` directory is ignored by Git; keep the client secret out of source, `dist/`, and browser variables. Setting both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server process environment overrides the file. `PVO_LOCAL_DATA_DIR` selects a different private data directory when needed.

The loopback server creates its own private account/session store in that directory and uses HttpOnly, SameSite=Lax cookies lasting seven days. It runs over HTTP on `127.0.0.1`, so these local cookies omit the production cookie's `Secure` attribute. Without the local client, `GET /api/auth/session` reports `available: false`; editing still works, but export waits for account services. This local static server does not provide publication uploads or R2 storage. For those, use the Worker with its configured D1/R2 bindings and exact HTTPS origin. `npm run dev:editor` serves only Vite and cannot complete live Google sign-in by itself.

For local Clerk email/password configuration, see the [local account setup](../docs/engineering/cloudflare-publishing.md#local-account-adapter).

## Browser suites

`npm run check:browser -- editor camera-flash camera-startup` checks front-camera screen light, recording and camera acquisition. `camera-flash` uses real canvas video streams and MediaRecorder with device capability fixtures to cover armed/idle and countdown states, tap/hold stop, recorder failure, ended tracks, camera switching, rear torch cleanup, and reachable recording controls. Set `BROWSER=webkit` for the flash check on an installed Playwright WebKit runtime. These fixtures do not verify a physical phone's light output or torch hardware; screen light follows the device's existing display brightness.

For export-quality diagnosis, run `node scripts/diagnostics/export-quality.mjs` with Vite serving the editor on port 5173, Chrome, Playwright WebKit, and FFmpeg/FFprobe installed. It checks output dimensions, first frame, colour, codec, and motion in both engines and reports encoded-duration drift separately; it is intentionally not part of the normal browser suite while WebKit's real-time timing issue remains unresolved.
Run `node scripts/diagnostics/export-cancel.mjs` against the same Vite editor to verify that cancelling a browser render stops its recorder, canvas capture track, and progress promptly.

Local HTTP routing lives in `scripts/dev/render-jobs/routes.mjs` and `scripts/dev/reply-boxes/routes.mjs`, with separate input, job/transfer and repository modules. `scripts/dev/server.mjs` composes them with auth; `scripts/dev/http.mjs` supplies shared Node HTTP helpers.

The local beta server on port 4173 also offers private FFmpeg render jobs for eligible exports. Sign in with Google or Clerk email/password on that beta before using the render API. Set `PVO_FFMPEG_PATH` and `PVO_FFPROBE_PATH` when the desired binaries are not on `PATH`; HLG/PQ uploads need an FFmpeg build with `zscale` (for example Homebrew `ffmpeg-full`). Set `PVO_RENDER_COOKIE` to the signed-in browser's `pvo-local-session=...` cookie header value, then run `node scripts/diagnostics/server-render.mjs` against the beta to check exact trim timing, H.264/AAC, and 720p/1080p/4K output. Run `EDITOR_URL=http://127.0.0.1:4173/editor/ npm run check:browser -- editor server-render` with Chrome and FFprobe for the upload-to-download UI path. `PVO_RENDER_ORIGIN` points the diagnostic at another local server. The production Worker render capability remains off until its Queue, Container and D1 migration are configured; see [server rendering](../docs/engineering/server-rendering.md).

`npm run check:browser -- editor export-dialog export-rendering cover-layout` requires Vite, generated WASM and Chrome. The dialog check covers desktop/phone settings, cover picking, cancellation and completed playback. The rendering check covers WebP layers/fonts, source/result animation clocks and media/URL cleanup. `cover-layout` compares the actual native DOM and canvas geometry at two sizes, including text, number, yes/no, collected-reply, styled and applied-font forms; it also checks the reply disclosure is painted. These representative fixtures guard shared behavior without claiming pixel identity for every authored style.

`npm run check:browser -- editor audio-extraction` verifies explicit audio extraction, independent movement/trimming, undo/cancel, original-audio muting, saved media, mobile deletion, and the audible timing of exported video including audio beyond the last video frame. It requires Vite, Chrome and `ffmpeg` on PATH; the test generates its own tone video and inspects the encoded audio.

The checks use `playwright-core` with an installed Chrome. Set `CHROME_PATH` when the browser is not at the Windows default path. This does not install a browser.

`npm run check:browser -- player restyle published layout` checks responsive light/dark player chrome, component clearance, sound and playback shortcuts, holds/retries, publication sharing and input preservation through a simulated keyboard viewport. These checks start their own fixture servers; `restyle` also accepts `PVO_PLAYER_URL` to verify a running build. Set `PVO_PLAYER_ARTIFACTS` to a directory to save the visual matrix. Simulated keyboard coverage does not replace an iOS/Android device check.

`npm run check:browser -- editor playback-view-switch` checks that a paused preview retains its requested frame when metadata arrives after a render or desktop/mobile view change. It also checks decoded pictures and advancing playback across both layouts, stopped removed video elements and returning from a scene without media. It requires Vite and Chrome; the real MP4 fixture uses gated byte-range responses to exercise loading reliably. `playback-smooth` checks uninterrupted playback, deliberate scrubbing and split-clip transitions, including against built beta output.

`npm run check:browser -- editor preview-startup` restores a portrait project with a compiled telephone form while the launch reveal stalls. With ordinary motion enabled, it suppresses preview ResizeObserver notifications and suspends any canvas size transitions, then checks immediate measured dimensions, initially hidden layout recovery, viewport resizing, observer cleanup and unchanged project data. It requires Vite, generated WASM and Chrome; the simulated interruptions do not establish the cause of a particular browser's rendering delay.

`npm run check:browser -- editor clip-adjustments` checks speed/playhead constraints, grouped crop undo, mirror, sound labels and text timing after the sheet/rule extraction. It requires Vite for its project fixture. The camera-startup suite explicitly uses a phone viewport so it exercises the camera rather than the desktop studio.

| Command | Prerequisites |
| --- | --- |
| `npm run check:browser:language` | Generated WASM and Chrome; compiler/player fixture servers start and stop themselves. |
| `npm run check:browser:runtime` | Chrome; the isolation fixture starts its own server. |
| `npm run check:browser:editor` | Editor Vite server and Chrome. Some older integration checks also open the player on the same origin; use the focused checks when validating only one feature. |
| `npm run check:browser:player` | Built static player server and Chrome. |

Choose focused checks with `npm run check:browser -- editor pvo-language pvo-export pvo-requests` or `npm run check:browser -- player playback actions`. Names match files in the suite, without `.mjs`.

`npm run check:browser -- player restyle published` starts source fixture servers and checks the player chrome in light and dark mode across phone, portrait/landscape tablet and desktop. It covers sound, keyboard and footage playback, held answers, reachable component targets, sharing, replay and layered content. The `actions` check also covers the submitting/error status widget and exactly one request per Retry. Set `PVO_PLAYER_ARTIFACTS` to a directory to save responsive screenshots; `restyle` can target built output with `PVO_PLAYER_URL`. These checks need Chrome and generated WASM, and do not replace physical device keyboard checks.

`npm run check:browser -- editor try-debugger` exercises a real sandboxed component and SDK request against a local HTTP fixture. It checks diagnostic correlation and 404 evidence, desktop/mobile panel geometry, retained last-run inspection, new-run reset and sanitized report output. It requires a fresh Vite server, generated WASM and Chrome. Restart Vite after source-module hot updates before running source-import fixtures, so the application and fixture share the same module instances. Run the existing desktop/editor workspace and request checks alongside it when changing shell integration or playback adapters.

`npm run check:browser -- editor try-debugger-media` uses the public interactive sample to verify a real final-frame pause, desktop report visibility, retained diagnostics across desktop/mobile rotation, read-only Locate, and Stop and edit. It also runs against built beta output and requires no source-module imports.

`npm run check:browser -- editor playhead-drag` checks direct mobile playhead dragging with touch input, preview seeking, release and cancellation, timeline swiping, bounds, keyboard access, viewport resizing, playback pausing and text timing selection. It uses public UI and also runs against built or deployed output through `EDITOR_URL`.

`npm run check:browser -- editor product-home export-share google-account-gate email-account-link auth-popup` verifies the mobile camera home, retained drafts, signed-in export/download and exact-file optional sharing, the Google popup gate, and explicit email account review. `email-account-link` covers a canceled Google popup, a lingering Clerk browser session, an account conflict, switching emails, and confirmation before ordinary email sign-in. `auth-popup` verifies the standalone desktop/phone layout, managed signup and signin mounting, dismissal and focus restoration, unchanged saved projects/media, and Google completion without starting an export. These checks run against Vite or built output through `EDITOR_URL`, with account/publishing responses and native share isolated by browser fixtures. They do not verify a live Google or Clerk account or remote R2. `npm run check:browser -- player published` verifies both published viewer formats with local fixtures. Backend integration coverage uses real local Worker/D1/R2 execution via `node --test tests/publishing-server*.test.mjs`; `node --test tests/local-google-auth.test.mjs` covers the loopback auth adapter.

`npm run check:browser -- editor collect-replies` requires a built local beta server and Chrome. Start it on an unused port with an isolated `PVO_LOCAL_DATA_DIR`, then set `EDITOR_URL` to that port's `/editor/` address. The check creates a Form reply box through the UI, verifies Try leaves the inbox untouched, downloads and plays the real `.pvo` in a separate browser context, reads the reply in More → Replies, and confirms deletion stops new submissions. It uses the real local reply API, mocks the account-session read, and disables unrelated remote rendering so the actual browser PVO exporter runs. It never sends replies to a deployed host.

For editor layout changes, `npm run check:browser -- editor sheet-dock timeline-resize panel-safe-area editor-viewport-fit playhead-picker` checks contained panels, touch/keyboard resizing, retained drafts and playback, nested cancellation, timeline restoration and phone-sized layouts. Timeline resizing also checks fixed row sizes, scrolling, layer interaction and independent panel sizes. `panel-safe-area` uses Chrome's safe-area emulation to check that fullscreen and near-fullscreen panel handles remain reachable in portrait and landscape; it requires a Chrome version supporting `Emulation.setSafeAreaInsetsOverride`. These browser checks do not replace a real-device keyboard and gesture check.

`npm run check:browser -- editor no-code-workspace` checks the component sheet's same-height timeline swap, visible player clamp, compact header, pull-down dismissal, scrolling, Try restoration and keyboard viewport choreography at 320, 390 and 430 px. Its keyboard signal is simulated; a real device is still needed to verify the OS keyboard itself. Older component checks that require fullscreen sheets or an Accept timing button describe the previous editing flow.

`npm run check:browser -- editor advanced-workspace` checks 80% code expansion at three phone and two desktop sizes, hidden outer navigation, retained source DOM/draft/caret, restored panel size, and a single floating orb through mocked HTTP operations, real compilation and immediate application. It also checks safe-area insets and a simulated phone keyboard viewport. It requires Vite and Chrome; keyboard simulation does not replace a device check.

`npm run check:browser -- editor pvo-formatting` checks automatic formatting on opening valid compact source, leaving a changed field, and receiving AI changes. Card and Form fixtures verify identical compiler output, preserved text and request literals, untouched focused text and invalid drafts, no Format button, and single-step Undo/Redo. It requires Vite, generated WASM and Chrome; only the AI HTTP response is mocked.

`npm run check:browser -- editor no-code-action-editing` covers direct PVO Form response-route edits, retained field identities and undo, action edits beside invalid source drafts, inline feedback for uneditable Logic, timeline-picker failures and scene-creation preflight.

`npm run check:browser -- editor request-separation` checks local form playback actions without network traffic, direct PVO request authoring in Advanced, retained requests when Advanced is hidden, typed submission and undoable replacement with a local action. It requires Vite and Chrome. Form domain/runtime tests also verify local response state and native exported-player behavior using the current request contract.

`npm run check:browser -- editor scene-tree` covers contextual scene navigation, the full tree confined to the timeline, phone-width overflow, scene management and outcome destinations. It runs against Vite or a production editor URL. Scene domain, persistence, terminal routed-scene playback and manifest rules also have Node regression tests.

Editor scripts honor `EDITOR_URL`, then the legacy `RESTYLE_EDITOR_URL`, then `http://127.0.0.1:5173/`. Player scripts honor `PVO_PLAYER_URL`, defaulting to `http://127.0.0.1:4173/player/`. Self-contained language checks use temporary local ports and need neither development server.

`npm run check:browser -- editor preview-gestures` sends real multi-touch input to text and component overlays, checks gesture history/cancellation and two-to-one-finger transitions, and verifies that page pinching stays disabled while sheet scrolling and Try mode remain functional. It uses only public UI and also runs against a production editor URL.

`npm run check:browser -- editor component-size` checks desktop/tablet Width and Height pixel fields for all four component types, independent axes, undo/redo, cancelled and bounded numeric input, original-size reset, stable canvas dimensions across viewport sizes, mobile control preservation, code-owned resizing and exported player dimensions. It requires Vite for project and player fixtures. Run `preview-gestures` alongside it when changing scaling rules.

`npm run check:browser -- editor layer-position` checks desktop and mobile X/Y pixel fields for text and component layers on the fixed 1080 × 1920 authoring canvas, Enter/blur commits, cancelled and blank edits, history boundaries, live position updates, visible placement and responsive persistence. It requires Vite and Chrome.

`npm run check:browser -- editor keyframes keyframe-timeline keyframe-rendering` checks [layer animation](../docs/engineering/layer-animation.md). `keyframes` covers property diamonds, sliders, all five layer kinds, phone whole-transform keys, easing, Undo and source clocks. `keyframe-timeline` covers selected property lanes, snapped and neighbor-clamped drags, one-step Undo, contextual Delete/K, easing pills, aligned responsive rows and audio envelopes. `keyframe-rendering` checks preview/canvas parity, live player motion, paused seeks, retained form state and real encoded export. They require a fresh Vite server, generated WASM and Chrome. Controls screenshots default to `/tmp/pvo-keyframes-check`; timeline screenshots use `/tmp/pvo-keyframe-timeline`.

`npm run check:browser -- editor keyframe-playback` checks real decoded video and synchronized playhead progress after adding and selecting component keyframes. It covers desktop Space playback from property diamonds, timeline keys, easing and the toolbar; retained keyframes, Enter activation, ordinary button Space behavior, Try mode, and the phone animation sheet. It requires a fresh Vite server and Chrome. Set `BROWSER=webkit` to run the same check with an installed Playwright WebKit runtime.

`npm run check:browser -- editor object-tracking-controls tracking-capture` checks tracking and its media input. `object-tracking-controls` uses `share/assets/preview.mp4` and deterministic `/api/assistant/track` replies to exercise desktop/mobile point picking, readable key density, cached refitting, Detach/Undo, cancellation and stale-result rejection. `tracking-capture` generates its own video with `ffmpeg` and checks actual sampled pixels, 15 fps endpoint timing, source trim/speed, mirror and existing animation, exclusion of text, unchanged playhead and media cleanup. Both require Vite and Chrome; `tracking-capture` also requires `ffmpeg` on PATH. Neither calls a GPU service or establishes SAM detection quality. See the [SAM service guide](dev/sam31/README.md).

`npm run check:browser -- editor orb-assistant assistant-voice pvo-overlay-bounds` checks the [orb assistant](../docs/engineering/orb-assistant.md), immediate application and guarded Undo, answer cards, responsive controls, hold/release input and fitted PVO preview bounds. These checks mock the `/api/assistant/status` capability preflight and `/api/assistant/turn` boundary with explicit fixtures and retain real compilation and application. Voice uses a synthetic microphone stream with real MediaRecorder encoding, offline WAV conversion and browser gestures; HTTP transcription is mocked, so it does not verify physical microphone permission or a live AI service. The orb workflow and bounds checks run against a production URL; the voice check requires Vite because it also inspects project state.

`npm run check:browser -- editor assistant-thread` checks the native Restyle conversation on desktop and phone: session exchanges, one composer, guarded row Undo/Redo, project reset, Escape, overflow and mobile dock geometry. It uses explicit assistant HTTP fixtures and requires Vite for project state setup.

`EDITOR_URL=http://127.0.0.1:5294/ npm run check:browser -- editor saved-tasks` checks the actual editor task card against real local workerd/D1/SQLite and IndexedDB. It exercises a lost creation response, page closure/replay, saved question/answer, Stop, reload, account isolation and desktop/phone layouts. Start a fresh Vite process from the checkout being tested (avoid stale HMR module instances); model output and the cookie-authenticated HTTP bridge are controlled fixtures. It creates no paid resources. The browser/runtime/temp storage are disposed on exit.

`EDITOR_URL=http://127.0.0.1:5295/ npm run check:browser -- editor saved-results` checks closed-page completion, full local workerd restart, restored real media identity, prepared-result download/compilation, atomic apply-once receipts, reload/Undo/Redo and preservation of a newer draft edit. Requires fresh Vite and generated WASM. Uses real IndexedDB/D1/SQLite with controlled native planning and trusted completion; no live builder or paid service is claimed. It also submits the checked form through its actual isolated renderer, loses a successful test-service HTTP reply, closes the page and restarts the server, then recovers the same saved action through IndexedDB. A distinct next Try action observes test capacity while hosting remains inactive. The subsequent `component-delivery.mjs` journey uses the real exporter, persists/retries an activation after failure and a lost successful reply, restarts workerd, downloads with publishing disabled, and opens that file on another player origin without creator cookies. It also verifies a pause blocks publication, upload retries preserve bytes/identity and the published player invokes the live service. Model and publication storage are controlled fixtures; browser/compiler/rendering/host/SQLite are real local instances.

`npm run check:browser -- editor task-project-link` checks the cloud task's local draft association through real IndexedDB saves, reloads, exact-media recovery, rename/Undo, independent project copies, and project navigation. It also checks account-scoped visibility, a delayed native assistant response across account switches, and failed-restore recovery. It requires Vite, Chrome, generated WASM, and the checked-in preview video; account/assistant HTTP is mocked. It creates no cloud tasks or paid resources.

`npm run check:browser -- editor assistant-logic-mode` verifies that Advanced off still permits custom appearances, blocks advanced logic without changing project/history, preserves one-step Undo/Redo, and rechecks preference changes during inference and the final commit. It requires Vite and mocks only the model HTTP reply; an injected prepared batch also exercises the current-switch guard independently of provider policy.

`npm run check:browser -- editor native-assistant native-preview assistant-media assistant-quiz-followup audio-gain` requires Vite and exercises native batches, stale-request cancellation, immediate real-media edits and Undo, bounded frame/audio inspection, quiz follow-up timing/spoiler edits, and exported audio gain. Native command tests replace only provider responses; the media fixture verifies decoded frame pixels and WAV audio while stubbing transcription text. These checks do not prove live provider availability.

A suite is a collection of existing behavioral checks, not a guarantee that every old workflow has kept pace with product changes. Report individual failures; do not weaken assertions to make a folder move pass. CI currently runs native Rust, format, JavaScript/Node, TypeScript, and production-build checks; browser suites remain explicit local checks.

`npm run check:browser -- editor no-code-components look-contracts component-sync` covers Content/Look/Action, current-wording presets, independent part styles, grouped undo, timeline picking, direct Advanced edits and draft recovery, form destinations, generated appearance compilation and player styles. `component-sync` checks all four component types through mocked HTTP AI operations, real compilation, immediate application, bidirectional content/style/action edits, saved reloads and an actual media export. These checks require the editor Vite server and generated WASM. The companion `no-code-workspace` check verifies the phone sheet and keyboard geometry. Browser keyboard simulation does not replace a real-device OS keyboard check.

`npm run check:browser -- editor notifications` checks the [notification policy](../docs/engineering/notification-policy.md): mobile safe areas, dismissal, pause on hover/focus, brief expiry, deduplication, retained critical issues, busy suppression and reduced motion. It requires Vite for notification fixtures. `orb-assistant` also checks distinct invalid-response, truncated-response and edit-validation notifications, preserved input/project state and absence of duplicate inline messages against development or production.

`npm run check:browser -- editor desktop-create` checks the studio at supported landscape sizes, the existing narrow/portrait editor, stable URLs across breakpoints, uploads, ratios, auth dismissal, exact-media recovery, independent local projects, templates and whole-page drops. It runs against Vite or a built beta URL; account availability is mocked.

`npm run check:browser -- editor desktop-editor` checks the approved Library / Player / Inspector / Timeline layout at 1440 × 900, 1280 × 800 and 1024 × 768, the existing narrow/portrait workspace, real sample playback, speed/split history, pixel sizes across viewports and save/reload, assistant placement, Try isolation, export entry and scene navigation. It uses public UI and real local checkpoints, and also runs against built or deployed output through `EDITOR_URL`.

`EDITOR_URL=http://127.0.0.1:5196/ WORD_TIMING_API=http://127.0.0.1:4174 node scripts/checks/editor/assistant-word-timing.mjs` requires a running Vite editor, the local Worker and the [MFA sidecar](dev/mfa/README.md). It uses the actual video fixture, sends one real alignment, then caches identical requests to check source/timeline mapping, private preparation, atomic Undo, desktop/mobile Try pause/resume, and failure rollback. Planner responses are explicit fixtures, so this does not establish autonomous model quality or human-verified acoustic accuracy. Set `WORD_TIMING_PREFLIGHT=1` to check extraction without provider calls. Reports default to `/tmp/pvo-mfa-native-validation`.

`npm run check:browser -- runtime fonts` verifies real font decoding, canvas glyph metrics, host-supplied fonts inside the unchanged renderer sandbox, font cleanup and a portable .pvo opened in the native/text/PVO player without web requests. It needs Chrome and generated WASM; its source fixture server starts itself.

`npm run check:browser -- editor assistant-web` uses real editor orchestration with mocked assistant/web endpoints. It verifies a general design search and clickable sourced answer without project edits, then a six-round independent-foundry font search/read/import/save/apply/verify workflow, real font decoding, private-byte exclusion and single-step Undo/Redo. It requires Vite, Chrome and generated WASM.

`npm run check:browser -- editor assistant-phone-form` uses the original phone-form request with mocked inference and real editor orchestration. On desktop and phone viewports it checks compiled telephone input, actual entry/submission, custom colors and a saved font, visible lower-right bounds, and one Undo/Redo for creation, placement and typography. It requires Vite, Chrome and generated WASM; it does not test the live model's choice of operations.

## Cloud agent infrastructure proof

The [Roadmap 1A evidence](../docs/engineering/restyle-cloud-infrastructure-proof.md) records account access, costs, limits, and cleanup. `scripts/checks/cloud-agent-infrastructure/preflight.mjs <account-id>` performs read-only checks. `workspace-proof.mjs <account-id> --run` creates a bounded Linux workspace, saves and independently hosts its output, tests limits, and verifies cleanup of both deployments and storage. `hosting-proof.mjs <account-id> --run` remains a smaller one-Worker check. Both can consume the account allowance and keep private cleanup journals under `.wrangler/cloud-agent-infrastructure/`. It does not activate a paid plan or deploy the Restyle application.

### Saved-task server lifetime

`node scripts/checks/cloud-agent-tasks/browser-lifetime.mjs` launches local workerd/D1/SQLite and a fresh Chromium context. It creates an authenticated saved task, closes the browser during a controlled planning step, and recovers the same question in a new context. Requires built language WASM, installed dependencies and Chrome (`CHROME_PATH` can override the executable). It disposes its local runtime/storage and never calls a real model or cloud provider. This checks server lifetime; the editor task UI is a separate later journey.

`node scripts/checks/service-submissions/browser-storage.mjs` verifies the shared submission client against actual Chromium IndexedDB: full browser shutdown/restart, exact pending retry, cross-tab transactions, rollback, closed-storage no-dispatch and retained completion. It bundles the source APIs into a controlled page, uses a disposable browser profile and controlled network responses, and requires installed dependencies plus Chrome (`CHROME_PATH` overrides the executable). No running editor/server or paid provider is needed; the profile and browser are removed on exit. Actual local service replay is covered separately by `tests/service-actions/submissions.test.mjs`.

### Cloud service recovery diagnostic

`node scripts/checks/cloud-agent-recovery/run.mjs <account-id> --run` performs the bounded, paid 1B.08/1B.09 provider acceptance and verifies cleanup of its own temporary deployment. Read the [resource/spending plan](../docs/engineering/restyle-cloud-provider-recovery-proof.md) and obtain the recorded spending decision first. It imports the production coordinator/release adapters and exposes only fixed, authenticated diagnostics. `node --test tests/cloud-services/*.test.mjs tests/assistant-task-server/provider*.test.mjs` runs local checks without provider charges; local workerd does not prove CPU enforcement.

### Cloud workspace recovery diagnostic

`node scripts/checks/cloud-agent-workspaces/run.mjs <account-id> --run` checks real Container restoration, forced coordinator interruption, Stop, timeout/descendant shutdown and output limits, then removes its disposable resources. Read the [bounded verification plan](../docs/engineering/restyle-workspace-provider-proof.md) and record approval before deployment. The local command `node --test tests/assistant-workspaces/*.test.mjs` uses real workerd/SQLite with controlled Container effects and does not spend provider credits. Neither a local pass nor a deployment dry run establishes real Container acceptance.

`EDITOR_URL=http://127.0.0.1:5299/ npm run check:browser -- editor hosted-services` checks the actual account service manager against local workerd/SQLite. It covers a lost activation response, reload and exact command replay, pause/resume, account isolation, explicit deletion and phone/desktop layouts. Start a fresh Vite process from the tested checkout. The checked service fixture and authenticated HTTP bridge are controlled; actions use the actual isolated runtime. No paid resources are created.


`npm run check:browser -- player service-submissions` starts and closes its own local static/HTTP/Worker fixtures and a disposable persistent Chromium profile. It exercises an actual compiled connected form, public preflight and cookie omission, lost successful replies, browser/server restart, empty-form recovery, saved-result replay and a distinct next action. It needs built PVO WASM and Chrome (`CHROME_PATH` overrides the macOS default), and creates no cloud resources. The PVO is a constructed fixture; normal export activation is separately pending 1E.06–09.
