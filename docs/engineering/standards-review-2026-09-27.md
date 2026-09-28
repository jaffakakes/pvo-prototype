# Coding standards review — 27 September 2026

The initial audit found partial compliance: folder ownership, naming and physical file sizes were generally good, with gaps in responsibility separation, UI-owned rules, state dependencies and formatting. The remediation at the end of this document records the subsequent changes and their verification. Small files alone do not establish compliance.

The initial review used the working tree, including uncommitted work, against the [coding standards](coding-standards.md) and [architecture](architecture.md). The [previous audit](code-audit.md) remains a historical record; its measurements and browser results are not current verification. Findings and source line references below describe the code before remediation.

## Scope and measurements

Source inventory covers `.ts`, `.tsx`, `.js` and `.rs` under `editor/src`, `player`, `server` and `packages`. Counts include blank lines and declarations, and exclude generated `pkg`/`target` directories and package tests. CSS is inspected separately. File inventory is comprehensive for those paths/extensions; detailed responsibility review concentrates on entry points, state, domain imports and the identified hotspots, rather than certifying every function.

| Area | Files | Files under 300 lines | Largest file |
| --- | ---: | ---: | --- |
| Editor | 198 | 198 | `infrastructure/projectPersistence/index.ts`, 293 |
| Player | 22 | 22 | `components/legacy-view.js`, 209 |
| Server | 17 | 17 | 91 lines |
| Shared packages | 46 | 44 | `pvo-code-runtime/index.js`, 535 |

There is no hard line limit in the standard. The sandbox exceeds its approximately 500-line review signal and also has independently identifiable responsibilities. The 321-line Rust Structure validator does not warrant splitting solely because of its size.

## Findings

### 1. Medium: timeline UI owns editing rules and history boundaries

[Timeline.tsx](../../editor/src/features/timeline/Timeline.tsx), lines 103–119, 134–148 and 169–183, combines pointer handling with minimum clip duration, source-time bounds, component timing and text timing rules. It also decides when an undo snapshot is created and when subsequent changes patch state.

This violates the separation of business rules from event wiring. Changing an editing constraint requires modifying a large rendering component, and another entry point cannot reuse these rules independently. Extract deterministic trim/move calculations into the relevant domain modules, with named commands owning history integration. Keep pointer capture and pixel conversion in the timeline feature. Preserve the intentionally different text, component and clip constraints; add regression coverage for limits, cancellation and undo grouping.

### 2. Medium: the sandbox public entry point has several responsibilities

[pvo-code-runtime/index.js](../../packages/pvo-code-runtime/index.js), 535 lines, includes field substitution and handler parsing (39–87), markup/CSS sanitization (103–171), the runtime document (179–229), and a mounted session (245–535) with rendering, event queues, request replies, rate limits, timers and disposal.

These concerns have different reasons to change. Keep public exports stable while extracting sanitization/policy, runtime-document generation, rendering and session coordination into cohesive internal modules. Preserve isolation and lifecycle behavior with the existing browser checks. This is structural debt, not a newly demonstrated sandbox vulnerability.

### 3. Medium: short UI files still mix workflows or effects with rendering

- [Sheets.tsx](../../editor/src/app/Sheets.tsx), lines 21–34, is only 35 lines but owns crop undo grouping, speed changes/playhead clamping, sound selection/preview and discard rendering. Move crop, speed and sound views and their commands to their feature owners; retain app-level routing here.
- [Camera.tsx](../../editor/src/features/capture/Camera.tsx), lines 95–130, still owns last-take removal, torch constraints and capture navigation decisions alongside rendering. Video import has already moved to `videoImport.ts`; the remaining device operation should live behind the camera adapter/hook, with editing/navigation decisions exposed as named commands.
- [ExportSheet.tsx](../../editor/src/features/export/ExportSheet.tsx), lines 31–63, coordinates export attempts, progress, stale-attempt checks, errors, downloads and presentation. `exportWorkflow.ts` already isolates rendering and media leasing, so finish the separation with a focused export-session hook or workflow instead of duplicating the existing renderer.

### 4. Medium: some boundaries still depend on broad or hidden state

[tryMode.ts](../../editor/src/features/preview/tryMode.ts), lines 9–25, imports the concrete capture store, owns module-level runtime/editing-location variables and accepts a complete `CaptureState` for runtime creation. Subsequent operations read the singleton directly. This obscures session ownership and makes independent sessions and isolated rule tests harder. Introduce an explicit session owner with narrow snapshot and effect contracts; retain deliberate differences between editor preview and player behavior.

[projectPersistence/index.ts](../../editor/src/infrastructure/projectPersistence/index.ts), lines 1–51, exposes `schedule(state: CaptureState)` even though persistence only needs a subset of project/history/navigation data. Its existing `ProjectMarkers` subset is useful evidence of a narrower boundary. Pass a persistence snapshot plus the relevant playback flag; keep store adaptation at the caller. Browser APIs in this infrastructure module are appropriate—the concern is its unnecessarily broad state contract.

### 5. Medium: dense formatting undermines the small-file result

[TextEditor.tsx](../../editor/src/features/text/TextEditor.tsx) has 45 lines but nine exceed 300 characters. [Timeline.tsx](../../editor/src/features/timeline/Timeline.tsx) has seven such lines; [Camera.tsx](../../editor/src/features/capture/Camera.tsx) has five. [Sheets.tsx](../../editor/src/app/Sheets.tsx) places entire screens on individual lines.

The standard explicitly requires readable JSX and prohibits compressing code to meet a size target. These measurements demonstrate density, not the author's intent. Format JSX, handlers and objects normally, then assess responsibilities. Increased line counts after formatting would be an improvement, not a regression.

The former `Capture.module.css`, particularly lines 51–58 and the text-editor rules from line 80, also spanned timeline, sheets, sound, export and text responsibilities. It was scoped CSS, but its ownership crossed features. Its current replacement is the [feature stylesheet composition](../../editor/src/EditorStyles.module.css); see the remediation below.

### 6. Low: duplicated catalog data and reversed ownership remain

[Timeline.tsx](../../editor/src/features/timeline/Timeline.tsx), line 203, repeats the sound names from [sound/catalog.ts](../../editor/src/features/sound/catalog.ts). Use the catalog so adding or renaming a sound cannot leave timeline labels stale.

[clipFactory.ts](../../editor/src/state/editing/clipFactory.ts), line 2, imports clip colors from the capture feature. Move model creation defaults to their appropriate model/configuration owner, or pass the selected color explicitly, so state creation does not depend on a presentation feature.

### 7. Low: naming and architectural rules rely on review

File names are generally intention-revealing: PascalCase views, `use…` hooks, descriptive commands, and feature-local modules. Kebab-case JavaScript and camelCase TypeScript are not violations: the current standard does not mandate one casing convention across languages. Public `index` facades are explicitly permitted.

`Capture.module.css` is the clearest misleading name because it styles multiple features. `Sheets.tsx` is also broader in implementation than its composition role suggests. Fix ownership before renaming. There is no evidence that a repository-wide rename would improve this architecture.

[package.json](../../package.json), [the JavaScript check](../../scripts/checks/javascript.mjs) and [CI](../../.github/workflows/check.yml) provide syntax, behavior, type, Rust and build checks. They do not provide a general JS/TS formatter, linter or import-boundary gate. Consider formatting and dependency checks as separate tooling work; do not use arbitrary file-size tests as a substitute for responsibility review.

## SOLID assessment

| Principle | Assessment |
| --- | --- |
| Single responsibility | Partially followed. Feature organization is strong; findings 1–3 and 5 identify concrete exceptions. |
| Open/closed | Existing runtime host handlers and export adapters provide useful extension boundaries. This review found no basis for introducing more abstraction universally. |
| Liskov substitution | Not established across every host adapter by this review. Passing Node tests do not certify editor/player browser contract parity. |
| Interface segregation | Good in narrow split/delete command contexts and export adapters; weaker in full-state persistence/runtime contracts. |
| Dependency inversion | Domain imports inspected contain no React, Zustand, state, UI, feature or infrastructure imports. Singleton preview state and state-to-capture catalog dependency remain exceptions outside the domain layer. |

## What is working

- Domain models/rules have their own ownership, separate from the Zustand store.
- `captureStore.ts` is thin composition, rather than a domain/UI monolith.
- Keyboard and toolbar split/delete operations both use `features/timeline/clipCommands.ts`.
- Export rendering accepts explicit adapters and releases leased media in `finally`.
- Editor TypeScript uses `strict: true`; the source scan found no explicit `any` type or TypeScript suppression directives.
- Package import inspection found no imports of editor/player internals. The editor domain import inspection found no outer-layer imports. These inspections are not a complete cycle or transitive-dependency proof.

## Verification and next steps

- `npm run check`: passed; 147 JavaScript source modules syntax-checked, 233 Node tests passed, none failed or skipped.
- `npm run check:editor`: passed.
- Browser suites, Rust checks, WASM rebuild and production build were not run for this source-structure audit. No application changes or beta deployment were made.
- Existing working-tree changes were preserved. The only authored change is this report.

Address timeline rules and the mixed sheet workflows first, followed by explicit preview/export session ownership. Schedule sandbox extraction as a dedicated change with isolation tests. Improve formatting and local style ownership incrementally. The app needs targeted refactoring rather than a new overall architecture.

## Remediation applied

The follow-up applies these changes while retaining newer component-timing and desktop-studio work already present in the checkout:

- Pure clip trim and text timing calculations now live in `domain/clips/trim.ts` and `domain/text/timing.ts`. State commands own undo grouping and active-scene updates; timeline gesture wiring is separate from its rendered tracks. The existing component-timing transaction remains intact.
- Crop, speed, sound and discard sheets have feature owners. `app/Sheets.tsx` only chooses a view. Clip adjustment commands coordinate edits and playhead bounds.
- Camera device controls and shutter presentation have dedicated owners. Export progress, attempts, errors and downloads are coordinated by `useExportSession`.
- `createTrySession` owns each preview runtime and editing position, with explicit host capabilities. `tryMode.ts` is application composition. Regression tests cover two independent sessions and a request completing after the preview stops.
- Persistence and checkpoint mapping accept a narrow project/history/resume snapshot. They no longer import the capture store or its types.
- Clip colors live beside clip models. Timeline sound labels use the shared sound catalog.
- The sandbox public API is unchanged. Policy, tokens, handler parsing, sanitization, runtime-document generation, renderer sizing and session coordination now have focused files. Browser fixture servers discover package modules rather than assuming a single runtime file.
- Dense JSX in the touched camera, timeline, text and sheet code is formatted normally. `EditorStyles.module.css` composes 28 feature/shared stylesheets in the original cascade order, replacing the misleading `Capture.module.css`. Existing pointer/test class hooks remain available.
- `npm run check:architecture`, included in `npm run check` and therefore the existing CI flow, rejects the declared import-direction violations. Formatting, purity, cycle freedom and behavioral contract parity still require review; no arbitrary line-count gate was introduced.

The largest touched JavaScript module is the 421-line sandbox session. It owns a session lifecycle and coordinates its focused adapters. This is not a claim that every unrelated file or workflow has been fully audited or rewritten. Shared font ownership and gradual retirement of the compatibility stylesheet namespace remain separate follow-ups.

### Verification after remediation

- `npm run check`: passed — 165 JavaScript syntax checks, 296 dependency-boundary checks and 263 Node tests; no failed or skipped Node tests.
- `npm run check:editor`: passed.
- Added regression coverage: source-time trim bounds, text timing, grouped undo, scene mirrors, speed/playhead adjustment, independent preview sessions and stale request completion.
- Browser passes: runtime isolation; language compiler and player; mobile component workspace at 320/390/430 px; clip adjustments; camera startup/flip/recording/cleanup/races; export/share; preview gestures; product home and draft recovery.
- `npm run build`: passed in an isolated output tree, including WASM and the production editor. Production product-home, export/share and preview-gesture checks passed against that output. Vite emitted its advisory warning for the approximately 503 kB main JavaScript chunk.
- Three older browser checks still fail: `timeline-resize` expects the obsolete picker text “Choice”; `camera-ratio` measures a 6×13 preview parent immediately after navigation; `capture-notifications` expects “Open editor” after retrying restoration. The latter two failures reproduced identically against the saved pre-refactor source. Those failures are recorded, not counted as passing checks; the legacy sheet-dock suite was not completed.
- Native Rust tests/format checks and hosted CI were not run; compiler rules were unchanged. A successful WASM build does not substitute for those checks.
- The active server was confirmed to serve this checkout's `dist/`. Both the task-start output and the newer output present immediately before publication were backed up. Assets were copied before HTML and service worker; old hashed assets were retained.
- The running beta serves `restyle-editor-shell-956f309c971474f0`. All 13 precache assets matched the built bytes. An isolated browser already running the prior beta displayed **New beta release** while retaining its clip, caption and page instance, without an automatic reload. The user's editing session was not controlled.
