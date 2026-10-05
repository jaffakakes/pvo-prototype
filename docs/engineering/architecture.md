# Architecture and ownership

The documentation, editor, player, SDK, and Rust language compiler have distinct source areas. UI and host adapters consume shared packages through their public entry points. Folder ownership follows the coding rules in [AGENTS.md](../../AGENTS.md); current remaining work is in the [audit](code-audit.md).

## Repository map

```text
pvo-prototype/
  AGENTS.md                     Repository-wide agent rules
  README.md / SPEC.md            Setup overview and canonical package format
  docs/
    site/                       Documentation website at /docs/
    language/                   PVO Structure, Style and Logic authoring guide
    engineering/                Standards, architecture and current audit
  editor/                       React/TypeScript recording and authoring app
  player/                       Standalone viewing app
  server/                       Cloudflare account, publishing, rendering and assistant routes
  packages/
    pvo-sdk/                    Format containers, validation and action runtime
    pvo-language/               Native Rust compiler and browser WASM facade
    pvo-code-runtime/           Isolated generated renderer and host bridge
    pvo-fonts/                  Validated font assets, browser scopes and portable packaging
    pvo-text-runtime/           Shared text styles and painter
    pvo-animation/              Shared numeric layer curves and visibility geometry
    pvo-component-runtime/      Shared no-code presets and bounded appearance values
  scripts/
    build/                      WASM, static site and sample/demo preparation
    dev/                        Local server, auth, render jobs and reply-box adapters
    checks/                     JavaScript checks and browser suites by owner
  tests/                        Node behavior tests
  share/                        Demo landing page and assets
  public/                       Product About, Privacy and Terms static pages
  assets/ / examples/           Media and format fixtures
  dist/                         Generated deployment tree
```

The product home `/` opens the camera/editor application under `/editor/`; mobile home selects the existing camera after recovering the local draft, while landscape tablet/desktop home (1024px and above) shows the create-project studio. `/about.html`, `/privacy.html` and `/terms.html` are static product pages for the canonical `https://getrestyle.app` origin. `/player/` opens local files and `/player/{id}` opens a published export through the Worker. Demo and documentation pages are excluded from product output. The documentation website uses its own HTML, CSS, and JavaScript in `docs/site/`, with a separate `npm run build:docs` output. Engineering and language Markdown are repository guides, not automatically rendered website pages.

`server/` owns Cloudflare routing, Google OIDC sign-in and account sessions, publication rules and D1/R2 adapters. Its entry point delegates to focused route modules; uploaded media is stored in R2 and account ownership/lifecycle records in D1. Editor and player consume the same HTTP publication boundary without importing server internals. Video/PVO export and publication require an account, while recording, editing, viewing and the assistant do not. The independent `server/assistant/` service uses the configured hosted inference provider and the shared PVO compiler to propose native project operations through `/api/assistant/turn`, with bounded media observation and transcription. Every provider-backed request first reserves capacity from the application-owned `AssistantBudget`; status fails closed when that binding is unavailable. The current beta allowance is 60 requests per UTC day across the service, 20 per client per day and twelve per client per minute. The minute allowance accommodates one task’s maximum six model turns and six metered observations. Each request also retains bounded media inspection, deadlines and one repair attempt, while the configured provider's account allowance remains an independent limit. Assistant availability does not depend on sign-in. See [publishing setup](cloudflare-publishing.md), the [product flow](publishing-plan.md), and the [orb assistant](orb-assistant.md).

`server/assistant/tasks/` owns the private saved-task HTTP boundary and per-owner SQLite Durable Object. Existing account sessions determine object selection; project/task IDs do not authorize access. Synchronous SQL calls shared task rules; the coordinator commits state and retention alarms together. Durable alarms now run bounded planning inferences under claims, persisting intent and usage before dispatch. `attempts.js` owns inference journaling; `runner.js` owns the bounded invocation lifecycle. Stop prevents further effects and stale results. Existing service-wide inference capacity is shared, with per-owner background limits and idempotent reservation/refund records. Inactive service publication now has a separate provider intent journal, bounded lookup/cancellation reconciliation and owned immutable releases under `server/cloud-services/`. Unknown outcomes are retained across crashes and Stop; cancellation tombstones prevent late publication. Shared release validation is under `packages/pvo-assistant/releases/`. Workspace construction, public activation and service storage remain later capabilities. See the [task API contract](../../server/assistant/tasks/README.md).

`packages/pvo-assistant/services/` owns the pure generated-service agreement and source-package contract: closed bounded data descriptions, named operations, behavior cases, safe source/test file paths, an empty initial dependency lock, canonical serialization and invocation/reply checks. It imports no platform or application code. Workspace/test/storage adapters must consume this public entry point and derive readiness from actual execution; package parsing grants no permission or test success. See the [service contract](../../packages/pvo-assistant/services/README.md).

`scripts/dev/server.mjs` composes loopback auth, `render-jobs/routes.mjs` and `reply-boxes/routes.mjs`. Those feature folders separate input validation, job/transfer ownership or repository storage from HTTP routing; `http.mjs` owns shared Node request/response helpers. Local adapters use the same public contracts as the Worker without importing browser applications.

`server/imessage/` owns the bounded test-message request and queue; `scripts/dev/imessage-bridge.mjs` is the Mac-only effect adapter that polls it and asks Messages to send the fixed text. The editor uses an ordinary checked PVO request, so it never gains direct access to Messages. See [Mac iMessage test sender](imessage-test.md).

## Dependency direction

```mermaid
flowchart TD
  Docs[Documentation site]
  Editor[Editor features and adapters] --> Domain[Editor domain rules]
  Editor --> SDK[PVO SDK]
  Player[Player controllers and UI] --> SDK
  Editor --> Bridge[Language browser facade]
  Player --> Bridge
  Bridge --> Bindings[JSON and WASM bindings]
  Bindings --> Compiler[Rust Structure / Style / Logic compiler]
  Editor --> Renderer[Isolated generated renderer]
  Player --> Renderer
  Editor --> Text[Text painter]
  Player --> Text
```

Editor and player must not import each other's internals. Server and local development adapters must not import browser application internals. Packages must not import their consumers, including scripts. The Rust compiler owns deterministic parsing, validation, compilation, diagnostics, and capability rules; it does not perform requests or playback. Bindings expose its contracts, and the JavaScript facade initializes WASM. Hosts validate events and execute checked outcomes.

Editor domain code depends on project data and package contracts, not React, Zustand, DOM elements, or UI state. Browser-oriented packages such as the renderer and text painter legitimately use browser capabilities. The generic SDK supports host handlers and retains its existing default network/browser behavior.

## Editor organization

```text
editor/src/
  app/                          App/editor composition, sheets and keyboard wiring
  domain/
    project/                    Models, snapshots, ratios and numeric rules
    clips/                      Timing and pure split/delete rules
    audio/                      Extracted audio and source ranges
    scenes/                     Naming, scene references and total duration
    layers/                     Layer identity and ordering
    animation/                  Keyframe clocks, layer edits and tracked motion rules
    components/                 Defaults, display metadata, Fields/PVO mapping and response policy
    preview/                    Pure Try playback boundary and resume decisions
    assistant/                  Answers, bounded context, atomic batch validation and thread models
    notifications/              Approved events, short copy, priority and repetition rules
    export/                     Pure project-to-manifest construction
  state/
    captureStore.ts / types.ts   Store composition and shared state contracts
    project/                    Initial state, history, session reset and scene sync
    components/                 Component commands, authoring state and measurements
    scenes/                     Scene commands and outcome routing
    editing/                    Clip, text, layer and overlay editing commands
    assistant/                  Request session, batch commit and guarded thread/notice Undo
    auth/                       Google/Clerk account session and sign-in gate
    export/                     Direct export commands, completed export and publication attempt state
    notifications/              Ephemeral notices and retained issues
    preferences/                Device editing, motion and appearance preferences
  features/
    capture/                    Camera, recorder and recording UI
    editor-layout/              Docked panels, resize gestures and viewport measurements
    desktop-editor/             Landscape Library, Player, Inspector and Timeline presentation
    timeline/                   Tracks, geometry, dragging and clip commands
    preview/                    Video, overlays and Try-mode host integration
    animation/                  Shared manual keyframes and tracking controls
    assistant/                  Orb and thread presentation, session orchestration and microphone input
    notifications/              Top notices, retained issues and accessible dismissal
    scenes/                     Scene selection UI
    text/                       Text authoring and overlay UI
    component-authoring/
      fields/                   Structured content editor
      look/                     Preset previews and scoped appearance controls
      outcomes/                 Requests and playback-route configuration
      language/                 Structure/Style/Logic editor and diagnostics
    export/                     Export workflow, preview lifetimes and controlled dialog views
    replies/                    Inbox presentation and account-scoped request workflow
    settings/                   Settings views and their styles
    sound/                      Music selection, audio layers and playback wiring
  infrastructure/               Media export, audio, language compilation, IDs
  ui/                           Shared icons, ratio menu, sheet frame, time formatting
  store.ts                      Stable compatibility API for existing consumers
  fonts/                        Existing font assets
```

These folders now exist. `app/Editor.tsx` composes focused views instead of implementing the full timeline and preview. `state/captureStore.ts` composes state behavior; domain models no longer live in the store. Keyboard and toolbar splitting/deletion share one command layer. Manifest mapping takes a project snapshot and compiled language data, while the export workflow owns compilation, media rendering, progress, and packaging.

State files are grouped by the responsibility they own. `state/project/` integrates project history and scene mirrors; feature command folders apply domain rules through the composed store. Transient authoring, assistant, account session, export and notification state stays with its own owner. Export and publishing workflows call the account gate before protected effects, and the Worker verifies the session again for publication writes. Import these modules directly; the existing `store.ts` compatibility API remains the shared entry point for existing consumers.

Cloud authoring-task locators and exact pending creation submissions live beside the local project checkpoint, outside scene snapshots, Undo, and exported PVO data. `domain/assistant/taskProjectLink` owns the bounded account/project binding rules; `state/assistant/taskProjectCommands` attaches validated task references through the project save path. `sessionScope` invalidates private assistant state and late replies on account/project changes. The checkpoint copy adapter creates an independent local identity and drops task associations. The owned server routes and durable planning runner are implemented. `features/assistant/saved-tasks/creationWorkflow` flushes the draft and exact bounded submission before sending its idempotent creation request; it replaces pending content with an owned locator only after the matching receipt. `taskSession` owns disposable progress reads and explicit answer/resume/Stop commands. The panel hides private data synchronously across account/project scopes. Native model output can propose only behavior examples in an exclusive `cloudTask` handoff, gated by server configuration, signed account and client support. Existing native editing remains atomic and anonymous. Workspace generation, service attachment and prepared-result application remain later adapters.

Editor appearance uses semantic chrome and button tokens in `theme.css`, with Light, Dark and System resolved on the document root before the first paint. `domain/appearance/` validates modes and accent IDs; `state/preferences/` holds the active preference and `infrastructure/preferences/` persists it. Mode is device-wide; the accent is keyed to a verified account ID in browser storage, and guests always use Magenta. Account refresh and sign-out update the active accent. This does not change authored component colors or the separate player theme.

`features/editor-layout/` keeps navigation, preview, transport and the lower panel in one measured layout. Panel height is local presentation state, outside project history. Component sheets inherit the timeline height when opened and clamp their maximum to keep the player, transport and header visible. Other panels retain their fullscreen expansion; those regions stay mounted and return when space becomes available. Shared shells use `ui/sheets/SheetDockContext.tsx` to register their dismissal and expansion behavior; the camera renders the same shells without a dock provider. Timeline picking hides the panel without unmounting its draft, then restores it. Try hides the lower region and restores its height alongside the original scene, playhead and selection when the session stops. OS keyboard viewport changes temporarily fit the sheet around the focused field without replacing its preferred height.

Timeline clip/text gestures share `state/editing/timelineTimingDrag` across the main timeline and compact timing controls. Focused trim/layer hooks handle pointer geometry; the transaction applies domain timing rules, commits one history entry, and restores cancelled previews without overwriting newer history. `useGestureCancellation` wires Escape, blur and unmount; pointer cancellation and lost capture follow the same rollback path. Component and audio timing retain their dedicated transactions.

Timeline and sheet panels share `usePanelResize` and `PanelResizeHandle`, with independent size state. Sheets may dismiss when pulled down; the timeline stops at a usable minimum. `useTimelineMeasurements` reads the natural track content and fixed scene/toolbar controls to determine the default and minimum, independently of the height allocated while dragging. The timeline's existing scroll container fills the remaining space without changing layer coordinates or editing commands.

The workspace owns top and side system safe-area padding outside its resizable grid. `useWorkspaceMeasurements` measures the usable height after that padding, so fullscreen and every intermediate size keep their drag handles below the status bar. Header and panel shells must not add another top inset. Bottom clearance belongs to the timeline toolbar and sheet scroll content.

`features/preview/useOverlayGestures` owns pointer capture, contact transitions and gesture cleanup. `state/editing/overlayTransform` previews edits through the existing text/component commands, rolls back cancellation and records one history snapshot on completion. Position limits live in `domain/layers/transform`; shared scale validation lives in `pvo-component-runtime`, with proportional pinch rules in `domain/components/scale`. Timeline component drags follow the same shape: `state/components/componentTimingDrag` previews start and duration through the component command, rolls back cancellation and records one snapshot on completion, while the start margin and minimum duration live in `domain/components/timing`. Optional component scale defaults to one for older projects. Independent `scaleX`/`scaleY` override their respective axes and travel through the existing `restyle_capture` export metadata; the player scales Fields and PVO renderers around their centers. Mobile keeps its existing tools, and pinching preserves the authored proportions. App touch policy prevents page pinching without replacing native single-finger scrolling.

Desktop and tablet Look tools expose Width and Height in canvas pixels through `features/component-authoring/size`. The fixed authoring canvas has a 1080px short edge, independent of window size and export quality. Explicit component `width`/`height` persist through history, checkpoints and export. `domain/components/pixelSize` retains the other axis when committing a dimension through the component command. `state/components/componentMeasurements` holds only transient natural bounds reported by the preview; they never enter project history. A shared runtime observer reads untransformed layout bounds so editor and player can fit both visual and code-owned content to the requested pixels. Each renderer disconnects its observers on removal.

The [orb assistant](orb-assistant.md) uses one composer for questions and whole-project edits. Validated user-requested edits apply immediately as one undo step on both mobile and desktop; a typed 2.4-second completion notice offers a guarded Undo action. Questions open an answer card. The visible Restyle thread records bounded session exchanges and offers guarded row Undo/Redo for the current exact history state. The session stores contain request, answer and thread data outside persistence and history; there is no staged proposal preview. `features/assistant/` coordinates views, voice, application and answers. `domain/assistant/native/` projects private project data into bounded context, prepares typed operations against an isolated snapshot and validates compiled component changes. `infrastructure/assistant/` owns same-origin `/api/assistant/turn` transport and the bounded observation loop; its media adapters sample real frames and extract bounded audio without moving the editor playhead. Microphone input records locally with MediaRecorder, converts to bounded mono WAV and uses the same transcription route only after explicit Send or hold release; cancellation releases tracks and aborts pending transcription. `packages/pvo-assistant/native/` shares strict operation and observation contracts with `server/assistant/native/`. The server runs hosted text, vision and transcription models with origin checks, size limits and deadlines; there is no local preset fallback. `state/assistant/nativeCommands.ts` commits the complete validated batch atomically through normal history, checking the original project fingerprint and current editing preference. `state/assistant/applyChanges.ts` then executes requested playback or export effects; `nativeAppliedNotification.ts` owns the temporary Undo receipt and prevents an old action from undoing a newer edit.

`useAssistantSession` owns UI, playback and voice lifetimes. `assistantRequestWorkflow` owns cancellation, stale-project rejection and final apply guards through narrow capabilities; `assistantSessionRequest` supplies concrete editor effects. `useReplyInbox` similarly binds presentation/account lifetime to `replyInboxWorkflow`, which owns loading, selection, deletion and late-response suppression. Previous-account data is cleared on owner changes.

`ExportSheet` composes controlled settings, progress, result and footer views. `useExportProgress` owns its timer; `previewUrl` and `useExportPreviewUrls` own pending cover/poster/PVO media URLs, cancellation and revocation. `useExportPreviewPlayback` owns source/result clocks, seeking and decoder cleanup. Cover selection uses the domain clamp. Native cover painting separates compositing, shared drawing primitives, native panels and form geometry; the `cover-layout` browser check compares DOM/canvas geometry, including reply controls and applied fonts. Native DOM and canvas layout rules still require coordinated maintenance.

`domain/components/presentation` owns component labels and time visibility shared by timeline, preview and export, so consumers do not import metadata from a React renderer.

Keep new feature code in its owning folder rather than expanding the compatibility `store.ts` facade. Crop/speed, sound and discard sheets have feature owners; `app/Sheets.tsx` only selects the view. Timeline pointer wiring calls pure clip/text timing rules through state commands. Component timing keeps its existing transaction command. Export sessions and camera controls have dedicated hooks, and each Try session owns its runtime through explicit host adapters. Persistence accepts a project/history/resume snapshot rather than the complete capture store.

Feature CSS is co-located with its views. `EditorStyles.module.css` imports the extracted styles in their original cascade order, retaining a single compatibility namespace for existing `cx` consumers and pointer hooks. New independent feature modules can continue using their own CSS modules. Further migration of the compatibility namespace and shared fonts is separate work.

### Camera light

The capture feature keeps flash selection separate from illumination. `useCamera` exposes the ready video track; `useRecorder` reports actual capture separately from the clip's save/finalization state. `useCameraFlash` arms a white front-camera screen light or a supported rear-camera torch only during capture. `cameraFlash` owns capability detection, actual camera facing, serialized constraint updates, and verification through track settings. Stopped recording, ended tracks, switching cameras, and leaving capture release the light. The screen layer stays outside recorded video and preserves access to the stop control.

### Try diagnostics

`createTrySession` composes an explicit host with focused request, response, runtime-bridge and diagnostic owners. `domain/preview/playback` supplies pure boundary/resume decisions; request cleanup and response epochs prevent a stopped or replaced session from applying late outcomes.

Try records a bounded, transient diagnostic run even when its panel is closed. The SDK exposes optional typed observation callbacks for actions, requests and state; the sandbox and host adapters add readiness, input and playback facts. Observer failures cannot reject an action. Shared packages never import the editor or its UI, and the standalone player can expose the same facts without mounting authoring tools. Diagnostics do not introduce PVO syntax or enter manifests, project saves, exports or undo history.

`domain/debugging/` owns diagnostic models, grouping, readiness, safe report construction and presentation-independent status rules. `state/debugging/` owns the current run and capture switch. The preview session supplies correlation identities and video position, while media adapters distinguish a requested action from actual media observations. Requests run independently of playback status: a running request alone does not mean the video is paused, and a missing HTTP status does not prove a server outage.

`features/try-debugger/` renders the shared Activity, State and Requests views. The mounted workspace explicitly chooses a desktop dock or mobile sheet; `features/editor-layout/debugging/` owns panel geometry, entry controls and navigation commands. The timeline and editing sheets remain mounted behind the diagnostic panel. Inspection and Locate do not seek, replay or mutate components. Stop and edit invokes the existing Try stop and authoring commands. The run survives Stop, is replaced by the next Try, and is discarded on project change or reload.

Capture is off for each new run and applies only to subsequent requests. Data is bounded and private string values are masked. Copied reports always exclude request/response bodies, state values, raw exception messages, headers, URL query values and credentials. Retention limits are explicit in the panel/report. There are no remote log uploads, step execution, state editing or automatic request retries.

The component sheet separates Content, Look and Action. Timing belongs to Content; Advanced is a device preference that exposes another editable view of the same component. `domain/components/` owns source/visual projection, exact appearance edits, named form fields and draft transitions. Source-backed rendering does not imply a visual editing lock. Pending or invalid drafts temporarily block Content and Look updates while retaining the draft and last validated source for explicit recovery. `componentAuthoringStore` holds only the selected tab and part, outside project history. Focused text edits and continuous colour gestures use the existing undoable command boundary.

Simple Action controls expose local playback routes. Form Action also offers first-party Collect replies: the editor provisions a reply box through its HTTP adapter and stores its fixed URL in the Form, while `domain/components/forms` generates the standard PVO request body. Try simulates that first-party request so preview never writes to the inbox. The Advanced switch reveals the PVO source editor for Structure, Style and Logic; custom network requests are authored directly in Logic, without a visual request setup panel. Forms store `fields.formSubmitMode: "local"`, `"collect"` or `"request"`; compiling a custom request action projects `"request"` into the form fields. Native exports carry the mode in `restyle_capture.form.submitMode`, so Try and the standalone player agree about whether form submission needs a network destination. Visual content and appearance edits preserve authored request methods, payloads and field identifiers.

`pvo-component-runtime` contains pure, validated appearance values used by the editor and standalone player. Visual component exports retain native manifest controls plus `restyle_capture` appearance/form metadata; code-owned components use the isolated PVO renderer. Both routes keep request destinations and playback outcomes under the existing checked host adapters. Form submission status follows the actual response.

The [desktop editor](desktop-editor.md) uses the approved Library / Player / Inspector / Timeline layout at 1024px and above in landscape. It shares the project route, capture store, playback runtime, history and authoring commands with the existing narrow/portrait editor. Desktop library insertion and selection commands own atomic history boundaries; the Inspector adapts the existing component editor to a side panel. Desktop tool actions without implemented adapters remain explicitly unavailable. Assistant transcription uses the bounded audio-inspection route described above.

Clip sound remains attached until the user selects **Extract audio**. `domain/audio/` owns independent source ranges and timeline positions; `domain/scenes/duration` determines the full authored duration from video, audio and explicit visual-layer ends. `state/editing/audioCommands` commits extraction, timing gestures, split/delete and history. Optional `Scene.audioClips` preserves compatibility with older projects, while `Clip.audioDetached` prevents the source video from also playing its sound. Extracted layers retain their media reference when the video is edited or deleted. Checkpoints, history, scene duplication, ID recovery and export snapshots include these references. The shared audio bar serves both timelines. `infrastructure/audio/audioLayerPlayer` owns preview/export audio elements and cleanup; rendered video and PVO scene media include the mix, with black frames when any authored layer extends beyond the video.

The cloud build workspace has a separate ownership boundary. `packages/pvo-assistant/workspaces/` owns pure lifecycle and bounded input contracts. `server/assistant/workspaces/` owns stable task identity, SQLite source/receipt storage, global compute reservations and native Container effects. Generated files and command output never grant readiness. These private adapters are not advertised as model tools until saved-task claims and the builder are connected. See the [workspace contract](../../packages/pvo-assistant/workspaces/README.md).

## Player and SDK organization

```text
player/
  app.js                        Session creation and controller wiring
  playback/                     Session state, timeline queries, transitions
  actions/                      SDK host adapter, component events, outcome routing
  media/                        Package loading, video/ambient painting, object URLs
  components/                   Views, visibility, overlays, compiled PVO source
  ui/                           Shared shell, responsive geometry, state presentation and input
  index.html / styles.css       Entry document and current app styling

packages/pvo-sdk/
  index.js / index.d.ts          Stable public API and declarations
  container/                    Binary input, PVOPACK1, legacy MP4/MOV, read dispatch
  manifest/                     Constants, manifest and action validation
  runtime/                      State paths, conditions, request policy, execution
```

The player owns an explicit per-viewer session and passes capabilities to controllers. `playback/transition-policy.js` makes pure response-boundary and clip-end decisions; `transition-state.js` supplies narrow state operations, and `transitions.js` applies media/UI effects. `components/component-view.js` owns custom-element events and pending controls, delegating structured Fields and manifest HTML rendering to `fields-view.js` and `manifest-view.js`. Generated PVO content keeps its separate sandbox boundary.

Local PVOs and published PVO/flat videos share the Restyle player shell. `ui/view-state.js` derives its sound, hold, sending, failure and completion presentation; `ui/input.js` wires footage, keyboard and button entry points to the same commands. The shell has no seek/control row. `ui/layout-geometry.js` owns fitting, lifting and collision calculations, while `ui/layout.js` measures the browser and preserves mounted component inputs through viewport/keyboard changes. Authored coordinates use the fitted footage rectangle. Ambient painting reuses the playing video and releases its timers with the viewer. `?debugHits=1` shows shell and Fields component targets, and `?cta=orange` pins an accent for visual checks. Creator attribution waits for public creator metadata; the current publication contract exposes a title and media duration only.

SDK public import paths, exports, declarations, schema, and container bytes describe the current development contract. Contract changes replace superseded shapes instead of adding compatibility paths. The publication list includes internal module folders. The static build copies the player and JavaScript package trees so their relative imports work after deployment.

## Rust language organization

```text
packages/pvo-language/
  Cargo.toml / Cargo.lock        Native crate and reproducible dependency resolution
  src/
    lib.rs                      Stable native public facade
    bindings.rs                 JSON envelopes and wasm-bindgen exports
    diagnostic.rs               Shared source-position diagnostics
    structure/                  Models, parsing and component-shape validation
    style/                      Syntax, scoped output and allowed visual values
    logic/                      Models, token reading, event grammar, route validation
    compiler/                   Whole-component compilation and escaped rendering
  tests/                        Public-API suites for each compiler responsibility
  index.js / index.d.ts          Browser facade and TypeScript contract
  pkg/                          Generated browser bindings and WASM; ignored
  target/                       Cargo build cache; ignored
```

See the [package ownership guide](../../packages/pvo-language/README.md) for internal roles and the [language guide](../language/README.md) for authoring syntax. Compiler validation, runtime host enforcement, and rendered component events are distinct responsibilities. Do not move DOM, network, or editor state into the Rust rules.

`pvo-code-runtime/index.js` preserves the public API. Source limits/protocol constants, token substitution, handler parsing, sanitization, runtime-document generation and rendering each have an internal owner. `session.js` coordinates the frames, event queue, request replies, watchdog and disposal. On WebKit, `control-proxies.js` places host-owned button hit targets over the script-disabled renderer because WebKit blocks parent-owned listeners inside that iframe; the same bounded action path handles the activation without granting scripts to component markup. Browser isolation checks cover this boundary. Keep the focused text painter intact unless a real second responsibility emerges. `pvo-fonts` owns immutable font assets and font scopes; application layers keep font bytes in history while interactive exports deduplicate them into packaged assets. The sandbox host installs binary font faces without granting authored CSS or runtime code font-network access.

## Build and verification

[Scripts and prerequisites](../../scripts/README.md) document stable npm commands and the grouped suites. `npm run check` checks JavaScript syntax, the declared dependency boundaries, pinned Prettier formatting for explicitly adopted files, and Node behavior tests. See the [coding standard](coding-standards.md#verification-and-review) for the limits of those checks; there is no general-purpose linter. Rust has native/format checks; browser fixtures verify compiler, editor, player and isolation behavior. The CI workflow installs locked Node dependencies and wasm-pack, then checks Rust formatting/tests, the production build, JavaScript/Node and editor types. Browser suites remain explicit local checks.

The production build includes the language facade and generated `pkg/`, not Cargo sources or `target/`. It replaces `dist/`; use an isolated build tree when existing generated output must be preserved. Player fonts still copy from `editor/src/fonts`; independent shared font ownership remains a follow-up. Node tests are discovered recursively under `tests/`, including the focused SDK suites in `tests/sdk/` and local adapter suites in `tests/server/`. The default is four concurrent files; `npm test -- --test-concurrency=2` overrides it.
