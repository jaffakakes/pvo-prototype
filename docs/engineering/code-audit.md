# Code structure audit

The current assessment is the [4 October 2026 organization audit](organization-audit-2026-10-04.md), with a separate [branch cleanup record](branch-cleanup-2026-10-04.md). The remainder of this file preserves the earlier snapshot.

Updated 26 September 2026 after the Rust/PVO language addition and the folder-organization pass. Counts include blank source lines and exclude generated files. This audit distinguishes completed structural work from remaining implementation work; line counts are navigation aids, not compliance scores.

This is a historical snapshot. The [27 September review and remediation](standards-review-2026-09-27.md) records subsequent extraction, dependency checks and verification; the remaining findings below describe the earlier state.

## Completed organization

| Area | Before this pass | Current ownership |
| --- | --- | --- |
| Documentation | Website separated, but language authoring guidance mixed with engineering notes. | `docs/site/`, `docs/language/`, and `docs/engineering/`; package implementation guides stay with their packages. |
| Player | `app.js`: 1,129 lines combining views, global state, loading, playback, actions and controls. | [`app.js`](../../player/app.js): 186-line composition; `playback/`, `actions/`, `media/`, `components/`, `ui/`. Largest JS module is 188 lines. |
| SDK | `index.js`: 853 lines combining binary formats, validation, conditions, requests and execution. | [Public facade](../../packages/pvo-sdk/index.js): 9 lines; 12 internal modules under `container/`, `manifest/`, `runtime/`. Largest module is 197 lines. |
| Editor state | `store.ts`: 471 lines combining domain types, catalogs, history, scene mirrors and commands. | [Stable state API](../../editor/src/store.ts): 10 lines; focused `domain/` and `state/` modules, with a small [store composition](../../editor/src/state/captureStore.ts). |
| Editor UI | `Editor.tsx`: 410 lines; `ComponentsSheets.tsx`: 285 lines with several screens/workflows. | [`app/`](../../editor/src/app/) composes `features/` views; authoring has separate `fields/`, `outcomes/`, and `language/` folders. Largest TS/TSX module is the 215-line timeline. |
| Rust language | Seven flat source modules; `logic.rs` 624 lines, `validate.rs` 419, `style.rs` 376. | [`structure/`, `style/`, `logic/`, `compiler/`](../../packages/pvo-language/src/) plus bindings and diagnostics. Largest Rust source module is 276 lines; Logic files are at most 172 lines. |
| Tooling | Build/server scripts and all browser checks mixed together. | [`scripts/build/`, `dev/`, `checks/`](../../scripts/README.md), with browser suites grouped by owner and stable npm commands. |

The source extraction preserves package import paths, public Rust/WASM exports, browser facade contracts, schema/declarations, and the existing routes. New files group real responsibilities rather than moving the original monoliths into differently named folders.

## Rust/PVO language audit

The new package is correctly shared by editor and player. Native Rust owns deterministic language rules; `bindings.rs` owns JSON/WASM envelopes; the JavaScript facade owns initialization; host adapters own playback and requests. The authoring language is Structure, Style and Logic, not arbitrary author-provided HTML/CSS/JavaScript.

- **Structure:** component model, markup parsing, shared field/attribute checks, and component-shape validation have separate owners.
- **Style:** syntax/scoping is separate from allowed properties and bounded values.
- **Logic:** action models, token cursor, event parsing, route/request validation, and permitted control events are separate modules.
- **Compiler:** orchestration, component metadata, and escaped rendering are separate from host execution.
- **Bindings:** public export names, JSON envelopes, diagnostic positions, and browser signatures remain stable.
- **Tests/output:** native integration suites exercise the public API. `pkg/` and `target/` remain generated and ignored; neither is source to reorganize manually.

The package has its own [agent rules](../../packages/pvo-language/AGENTS.md) and [ownership guide](../../packages/pvo-language/README.md). The refactored WASM was compared against the original across 94 calls: successful results, diagnostic outputs, and capability results matched exactly, as did export names and generated TypeScript signatures. This is parity evidence for the tested cases, not a proof covering every input.

## Business-rule separation improved

- Project types no longer live inside the Zustand implementation. Editor domain code has no runtime dependency on app, feature, state, UI, or infrastructure modules.
- Clip-time calculations and layer ordering are separate from timeline pixel geometry. Toolbar and keyboard splitting/deletion use shared commands with pure editing rules and one undoable commit.
- History snapshots and active-scene synchronization have explicit owners. Regression cases cover split timing/history, deletion while other scenes contain media, and independent compiled-language data when cloning.
- Manifest construction consumes a project snapshot and compiled language data. Compilation, media rendering, URLs, packing, downloads, and progress remain outside that pure mapping.
- Player state belongs to an explicit session. Controllers receive capabilities rather than importing the old global entrypoint. SDK request policy and execution are independently located.

A read-only review found no runtime import cycles in the reorganized editor and no domain imports into its outer application layers. Those boundaries are still a review requirement, not an automated architecture gate.

## Remaining findings

| Priority | Owner | Finding and next step |
| --- | --- | --- |
| High: existing functional issue | [`player/actions/components.js`](../../player/actions/components.js), `validFormValues` | Forms described only by the manifest are rejected because validation requires a compiled PVO Structure form. The player action browser check fails on this path. The task-start validator reproduces the same rejection and matches the extracted validator; this is pre-existing, not a changed rule in this organization pass. Resolve manifest-form versus compiled-form validation explicitly, with the existing request/form workflow as the regression case. |
| Medium | [`packages/pvo-code-runtime/index.js`](../../packages/pvo-code-runtime/index.js), 523 lines | Sanitization, worker/frame setup, protocol, requests, queue/limits, sizing and disposal remain combined. Extract protocol/policy, renderer and session lifecycle in a dedicated change, preserving the tested isolation model. |
| Medium | [`editor/src/app/Sheets.tsx`](../../editor/src/app/Sheets.tsx) | Crop, speed and sound controls still share the app-level sheet switch. Move these views/workflows into their feature owners when next changed. |
| Medium | [`editor/src/features/capture/Camera.tsx`](../../editor/src/features/capture/Camera.tsx) | Media import/metadata and device workflows still accompany camera UI. Extract import/device adapters without changing recorder behavior. |
| Medium | [`editor/src/features/timeline/Timeline.tsx`](../../editor/src/features/timeline/Timeline.tsx) | Geometry, clip commands and component timing drags have moved out; clip trim and text timing decisions remain in gesture handlers. Extract those calculations with gesture regressions as that area evolves. |
| Medium | [`editor/src/features/preview/tryMode.ts`](../../editor/src/features/preview/tryMode.ts) | Preview still integrates through singleton state/runtime. Establish shared editor/player transition contracts before attempting another abstraction; do not silently merge product differences. |
| Medium | [`editor/src/features/export/ExportSheet.tsx`](../../editor/src/features/export/ExportSheet.tsx) | Export/download kickoff remains in the view, although manifest rules and compilation/rendering are separate. A dedicated workflow hook would further isolate lifecycle handling. |
| Lower | [`editor/src/state/editing/clipFactory.ts`](../../editor/src/state/editing/clipFactory.ts) | Clip creation still consumes the capture presentation catalog. Separate display defaults from model creation in a focused follow-up. |
| Lower | Global styles, fonts and inherited formatting | `Capture.module.css`/`styles.ts` still span multiple features; some JSX remains dense; player fonts are copied from editor sources. Move local styles and shared assets as their owners are touched, without a blanket visual rewrite. |
| Lower | [`tests/sdk.test.mjs`](../../tests/sdk.test.mjs) | Container, manifest and runtime cases still share one Node test file. Group them when expanding those suites, and update the current flat test-discovery pattern. |

Keep generated renderer isolation separate from language authoring policy. Older sandbox APIs exist internally, but the new authoring workflow packages PVO source. Do not reintroduce arbitrary code authoring to simplify a migration.

## Build and tooling changes

The static build now copies the player and JavaScript package module trees. SDK publication includes its internal modules, confirmed by an npm package dry run. The source-player browser fixture discovers dependent modules instead of serving only entry files. The language facade and generated WASM are copied explicitly, keeping Cargo source/cache out of browser output.

Browser scripts are grouped by editor, player, language, and runtime; their CLI and prerequisites are in [scripts/README.md](../../scripts/README.md). Fixtures use the stable editor state API and updated manifest/export paths. JavaScript syntax checking discovers source modules instead of checking a few hardcoded entry files.

CI now installs locked Node dependencies, Rust/rustfmt and wasm-pack, then runs native tests, formatting, production build, JavaScript/Node and editor types. This configuration has been reviewed locally; a hosted CI run was not triggered. JavaScript/TypeScript formatting, linting and import-boundary enforcement remain future improvements.

## Validation

- `npm run check`: 61 source JavaScript modules checked and 33 Node tests passed.
- `npm run check:editor`: passed.
- Native Rust: 21 tests passed; rustfmt passed.
- Refactored WASM build and 94 before/after output comparisons: passed.
- Production static and editor build: passed in an isolated temporary tree, preserving workspace `dist/` changes.
- Browser compiler, source-player language, isolation, language authoring, real-media export, compiled and Fields requests, layers, playhead picking, recording/text/video export, camera ratios, and toolbar checks: passed. The capture fixture was updated to use the existing More settings route for ratio selection; its ratio/history/export assertions remain.
- Built `/docs/`, `/editor/`, and `/player/` loaded without browser/asset errors. PVO language authoring also passed against the production editor build.
- Both general player checks (`actions` and `playback`) fail at manifest-only form submission on the confirmed pre-existing validation issue above. Compiled-language player checks pass. This is not a blanket passing browser-suite claim.
- Documentation links and moved source/tool references were checked. Hosted CI was not run, and optional capture checks requiring separately supplied media fixtures were not invoked.

The next work should address the known manifest-form behavior, then sandbox lifecycle decomposition and remaining editor feature ownership. The original oversized player/SDK/Rust modules and combined editor entry/state files have been split; another repository-wide move is not needed.
