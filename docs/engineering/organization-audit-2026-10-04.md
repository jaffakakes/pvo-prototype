# Organization audit — 4 October 2026

The architecture is still substantially intact. Feature grouping, domain boundaries, small files, descriptive names and useful comments remain present. The code needs targeted maintenance in a few workflows; the evidence does not support a repository-wide reorganization.

The main weakness is duplicated or mixed ownership inside otherwise sensible folders. Small files and a passing dependency check do not, by themselves, establish single responsibility or SOLID compliance.

This is an audit of the current working tree, including pending and untracked source, on `codex/orb-conversation-thread` at `73674cc`. Another task was actively editing themes in the same checkout. Counts and line references describe the inspected snapshot, not a frozen production release. No application code was changed by this audit. See the separate [branch cleanup record](branch-cleanup-2026-10-04.md).

## Evidence and scope

Reviewed the [coding standard](coding-standards.md), [ownership architecture](architecture.md), earlier audits, source dependencies, important callers, workflow implementations and relevant tests. Counted `.ts`, `.tsx`, `.js`, `.mjs` and `.rs` source under editor, player, server and packages, excluding CSS, generated directories and package test directories. Type declarations are included.

| Measure | Snapshot |
| --- | ---: |
| Application/package code files | 514 |
| Files at most 300 lines | 504 (98%) |
| Files at most 200 lines | 480 (93%) |
| Median file length | 48 lines |
| Files over 500 lines | 1 |
| Editor TS/TSX files | 365 |
| Editor TS/TSX files over 300 lines | 8 |
| Largest player JavaScript file | 250 lines |
| Largest server JavaScript file | 160 lines |

Lengths include blank lines. They are navigation aids, not quality scores. CSS, tests and fixtures were also inspected, but their sizes are not treated as equivalent to application controllers.

## Findings, in cleanup order

### 1. Unify the transaction contract for timeline edits

**Medium priority; observable divergence found by code inspection.** Mobile clip/text timing edits and desktop edits have different command and cancellation lifecycles.

- [Mobile gestures](../../editor/src/features/timeline/useTimelineGestures.ts), lines 216–279 and 357–419, call [preview commands](../../editor/src/state/editing/timelineEditingCommands.ts), lines 9–48. These write history on the first movement. `textBarUp` finishes its preview even for `pointercancel`; it does not restore the original timing.
- [Desktop pointer wiring](../../editor/src/features/timeline/useTimingPointer.ts), line 68, uses [the timing transaction](../../editor/src/state/editing/timelineTimingDrag.ts). Its `commit` and `cancel`, lines 107–125, record history on completion or restore the original state. The hook also handles Escape, blur and unmount.

The same editing operation therefore has two workflow owners despite sharing some pure calculations. Route both through one transaction command, retaining their distinct pointer geometry. Preserve or explicitly decide cancellation behavior with regressions in the existing timeline suites. The divergence was not reproduced in a browser during this audit.

### 2. Reduce the responsibilities of the Try-session controller

**Medium priority; accumulated debt.** [createTrySession.ts](../../editor/src/features/preview/createTrySession.ts) is 528 lines, already that size in HEAD. It coordinates editing-location restoration and lifetime (line 111), scene/time transitions (175), response mutation (241), request execution/cancellation/feedback (258), dispatch eligibility (381), and playback boundary decisions (448).

The explicit host interface is a good foundation, but policy and asynchronous lifecycle effects share one closure. Extract pure transition/boundary decisions and a focused request-execution owner. Keep session composition here. Preserve intentional editor/player differences and request cancellation guarantees; avoid replacing them with a broad generic controller.

### 3. Finish separating export presentation from media workflows

**Medium priority; recent growth.** [ExportSheet.tsx](../../editor/src/features/export/ExportSheet.tsx) grew from 165 lines in HEAD to 302 in the working tree. It derives dialog/progress states, controls focus and timers, owns cover URLs, bounds cover timing, gates download/share actions, and renders every state. Its cover clamp at line 134 repeats the bound owned by [exportCoverAt](../../editor/src/domain/project/cover.ts), line 6.

The new [ExportPreview.tsx](../../editor/src/features/export/ExportPreview.tsx), 277 lines, unpacks media (113), drives video loading (131), owns a synthetic playback clock (164), implements seeking (177), and renders the view (214).

Build on the existing `useExportSession` and `exportWorkflow`: move cover-preview and preview-playback lifecycles into focused hooks/adapters, keep shared cover rules in domain code, and make state-specific presentation readable. Preserve cancellation, URL release and playback behavior with lifecycle coverage.

### 4. Give local backend implementations an explicit owner

**Medium priority.** [Local render jobs](../../scripts/dev/render-jobs.mjs), lines 45–227, combine input checks, job storage, expiry, queue execution, upload, cancellation, HTTP handling and renderer configuration. The production equivalents are already split under `server/render-jobs/`. [Local reply boxes](../../scripts/dev/reply-boxes.mjs), lines 81–193, similarly combine storage, ownership, quotas, CORS and routing. Reply limits appear both here and in [the production repository](../../server/replies/repository.js).

`scripts/dev` now contains substantial product behavior as well as tooling. Keep the development entry point as composition, group its feature adapters clearly, and share genuinely common validation/policy through narrow contracts.

The [larger local rendering limits](server-rendering.md) and [browser-cookie local reply inbox](cloudflare-publishing.md) are documented environment differences. They are not, by themselves, defects; preserve those distinctions when removing duplication. Local tests do not automatically establish hosted behavior parity.

### 5. Move shared component metadata out of a renderer

**Lower priority; small file, real dependency problem.** [ComponentOverlay.tsx](../../editor/src/features/preview/ComponentOverlay.tsx), only 68 lines, exports pure `componentLabel` and visibility rules at lines 14 and 28 alongside React rendering, authoring state and debugger dependencies.

The mobile timeline, desktop visual rows, desktop timeline toolbar and component picker import this renderer to obtain the label. Put the shared metadata and visibility rules beside the appropriate component rules, then have each view consume them. This is a useful small cleanup independent of the larger controllers.

### 6. Narrow player contracts and centralize server state transitions

**Lower/medium priority; incremental work.** The player folders are well organized, but most controllers receive the whole mutable [viewer session](../../player/playback/session.js) through [app composition](../../player/app.js), lines 27–109. [Transitions](../../player/playback/transitions.js), lines 17–68, mix policy decisions, state mutation, media effects and UI updates. Narrow their data/capability contracts as these flows change; retain the useful per-viewer session.

In [render-job routes](../../server/render-jobs/routes.js), lines 49–50, a queue failure writes a database state transition directly despite [repository transition functions](../../server/render-jobs/repository.js) already owning related changes. The same route module also contains the signed internal transfer protocol at lines 77–118. Move the failure transition into the repository and separate the internal transfer adapter when next changing that area.

These are interface segregation and ownership concerns in short files, not evidence that every controller needs splitting.

### 7. Improve names and formatting where they conceal responsibilities

**Lower priority.** [legacy-view.js](../../player/components/legacy-view.js) implements the current Fields renderer, including Collect replies, as well as manifest HTML/CSS rendering and event translation. Its name suggests obsolete functionality and does not explain its current role. Rename the host around its actual responsibility and separate rendering strategies when their independent changes warrant it.

Readability is uneven: this file's CSS at lines 129–141, [ExportSheet JSX](../../editor/src/features/export/ExportSheet.tsx) from line 149, and [ComponentOverlay's outer element](../../editor/src/features/preview/ComponentOverlay.tsx) at line 55 pack several decisions or operations onto single lines. Expand them and name handlers/decisions where touched. Comments cannot compensate for dense structure.

Names such as `beginComponentTimingDrag`, `exportCoverAt`, `captureExportSnapshot` and `layout-geometry` are otherwise clear. Feature folders and co-located styles remain the dominant convention.

### 8. Bring test organization and enforcement up to date

**Lower priority; partly recorded historical debt.** There are 82 files directly under `tests/`. [sdk.test.mjs](../../tests/sdk.test.mjs) has 739 lines covering containers, manifests, templates, execution, requests and schemas, although source ownership is already separated. Group this suite by responsibility with focused fixtures, updating the flat `tests/*.test.mjs` discovery pattern in [package.json](../../package.json) at the same time.

Do not split cohesive preview-session or gesture suites simply because they are long. Their behavior and failure paths are more useful review criteria.

[The dependency gate](../../scripts/checks/dependencies.mjs) enforces selected import directions. It does not assess responsibilities, broad mutable interfaces, duplication, purity, formatting or behavior parity; it also excludes `scripts/dev`. There is no configured general JS/TS formatter or linter. A formatter and carefully scoped checks would improve consistency, but responsibility review remains necessary.

## What should be retained

- `app/Editor.tsx` is a 54-line composition; `state/captureStore.ts` is a 36-line store composition.
- The checked domain dependency boundaries pass. Reviewed domain code keeps media and network effects outside its rules.
- Player geometry, DOM measurement and view-state derivation have separate owners. Player keyboard and button entry points use shared commands.
- Rust Structure, Style, Logic and compiler ownership remains clear. Shared packages do not import their applications in the enforced dependency checks.
- Comments still explain useful invariants: another component must not release a Try hold; drag previews keep their snap target still; authored request payloads must survive visual edits; sandbox observers belong to the session being disposed. These are the right reasons to comment.
- Explicit resource cleanup remains visible, including renderer session disposal. The 457-line sandbox session and 321-line Rust validator are not automatically split candidates.
- Camera and desktop visual-layer rows are relatively long, but delegate important workflows and remain largely cohesive presentation owners. Their lengths alone do not justify a rewrite.

SOLID is present most strongly in dependency direction and focused domain functions. Single responsibility and interface segregation are less consistent in the workflows identified above. There is no need for class hierarchies, factories or trivial forwarding modules to improve that.

## Verification and limits

- `npm run check`: passed — 302 JavaScript syntax checks, 493 modules checked for dependency boundaries, 609 Node tests passed, none failed or skipped.
- `npm run check:editor`: passed.
- Supplemental relative static runtime-import graph: 484 JS/TS modules and 1,432 edges, no cycles found. TypeScript type imports were removed first. This is not a claim about dynamic imports, all possible resolution mechanisms, or type-only dependency cycles.
- No application changes, build, deployment, native Rust checks or browser suites were performed for this audit. A beta rebuild was unnecessary because only audit documentation was added. Passing Node/type checks does not establish browser behavior or complete SOLID compliance.

Start with the shared timeline transaction, then the Try-session and export boundaries. Keep those refactors separate from deliberate behavior changes and from broad formatting changes. The remaining findings are focused follow-ups, with shared metadata extraction offering a small independent improvement.
