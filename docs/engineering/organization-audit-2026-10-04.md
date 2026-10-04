# Organization audit — 4 October 2026

The [implementation update](#implementation-update) records the completed follow-up changes. The earlier sections retain the evidence and limitations of their inspected snapshots.

The architecture is still substantially intact. Feature grouping, domain boundaries, small files, descriptive names and useful comments remain present. The code needs targeted maintenance in a few workflows; the evidence does not support a repository-wide reorganization.

The main weakness is duplicated or mixed ownership inside otherwise sensible folders. Small files and a passing dependency check do not, by themselves, establish single responsibility or SOLID compliance.

The initial sections below preserve the historical working-tree audit, including pending and untracked source, on `codex/orb-conversation-thread` at `73674cc`. The [reconciled source assessment](#reconciled-source-assessment) at the end updates that evidence after integration with newer production work. Another task was actively editing themes in the same checkout. Counts and line references describe the inspected snapshot, not a frozen production release. No application code was changed by this audit. See the separate [branch cleanup record](branch-cleanup-2026-10-04.md).

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

- [Mobile gestures](../../editor/src/features/timeline/useTimelineGestures.ts), lines 216–279 and 357–419, call [preview commands](https://github.com/jaffakakes/pvo-prototype/blob/9bcc1bc9856c6d1b0af4aa7bb8b3550308d3f734/editor/src/state/editing/timelineEditingCommands.ts), lines 9–48. These write history on the first movement. `textBarUp` finishes its preview even for `pointercancel`; it does not restore the original timing.
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

**Medium priority.** [Local render jobs](https://github.com/jaffakakes/pvo-prototype/blob/9bcc1bc9856c6d1b0af4aa7bb8b3550308d3f734/scripts/dev/render-jobs.mjs), lines 45–227, combine input checks, job storage, expiry, queue execution, upload, cancellation, HTTP handling and renderer configuration. The production equivalents are already split under `server/render-jobs/`. [Local reply boxes](https://github.com/jaffakakes/pvo-prototype/blob/9bcc1bc9856c6d1b0af4aa7bb8b3550308d3f734/scripts/dev/reply-boxes.mjs), lines 81–193, similarly combine storage, ownership, quotas, CORS and routing. Reply limits appear both here and in [the production repository](../../server/replies/repository.js).

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

**Lower priority.** [legacy-view.js](https://github.com/jaffakakes/pvo-prototype/blob/9bcc1bc9856c6d1b0af4aa7bb8b3550308d3f734/player/components/legacy-view.js) implements the current Fields renderer, including Collect replies, as well as manifest HTML/CSS rendering and event translation. Its name suggests obsolete functionality and does not explain its current role. Rename the host around its actual responsibility and separate rendering strategies when their independent changes warrant it.

Readability is uneven: this file's CSS at lines 129–141, [ExportSheet JSX](../../editor/src/features/export/ExportSheet.tsx) from line 149, and [ComponentOverlay's outer element](../../editor/src/features/preview/ComponentOverlay.tsx) at line 55 pack several decisions or operations onto single lines. Expand them and name handlers/decisions where touched. Comments cannot compensate for dense structure.

Names such as `beginComponentTimingDrag`, `exportCoverAt`, `captureExportSnapshot` and `layout-geometry` are otherwise clear. Feature folders and co-located styles remain the dominant convention.

### 8. Bring test organization and enforcement up to date

**Lower priority; partly recorded historical debt.** There are 82 files directly under `tests/`. [sdk.test.mjs](https://github.com/jaffakakes/pvo-prototype/blob/9bcc1bc9856c6d1b0af4aa7bb8b3550308d3f734/tests/sdk.test.mjs) has 739 lines covering containers, manifests, templates, execution, requests and schemas, although source ownership is already separated. Group this suite by responsibility with focused fixtures, updating the flat `tests/*.test.mjs` discovery pattern in [package.json](../../package.json) at the same time.

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


## Reconciled source assessment

**4 October 2026, after production reconciliation.** This addendum reviews the combined source on `codex/pending-work-production`, including native assistant, themes, export, replies and player changes. It supersedes the initial size snapshot for the release candidate; it does not rewrite the earlier observations or imply that the candidate is already deployed. Counts include tracked and untracked source, use the original extensions/exclusions, include declarations, and exclude package test directories.

| Measure | Reconciled source |
| --- | ---: |
| Application/package code files | 673 |
| Files at most 300 lines | 663 |
| Files at most 200 lines | 636 |
| Median file length | 49 lines |
| Files over 500 lines | 1 |
| Editor TS/TSX files | 459 |
| Editor TS/TSX files over 300 lines | 8 |
| Largest player JavaScript file | 252 lines |
| Largest server JavaScript file | 176 lines |

**The organizational foundations remain.** Growth is mainly in feature-owned modules, with thin editor/store composition still at 54/36 lines. These counts locate review candidates; they do not prove that a file has one responsibility. Neither the 256-line native cover painter nor the 465-line sandbox session needs an arbitrary split simply to reduce length.

### Latest feature boundaries

- **Native assistant:** [shared parsing/schema](../../packages/pvo-assistant/native/), [project operations](../../editor/src/domain/assistant/native/), [history/application commands](../../editor/src/state/assistant/), [media and transport adapters](../../editor/src/infrastructure/assistant/), [provider/service policy](../../server/assistant/native/) and [orb/thread/voice presentation](../../editor/src/features/assistant/) have distinguishable owners. Batch preparation receives compilation, IDs and font data explicitly; the store applies a validated batch once. The bounded [task runner](../../editor/src/infrastructure/assistant/runNativeTask.ts) receives adapters instead of importing React or the store. This is practical dependency inversion, not just folder naming.
- **Export:** `exportWorkflow`, `useExportSession`, `pvoMediaSource`, `captureCoverFrame` and `ExportAccountGate` identify real responsibilities. Cover capture now consumes the same [ordered scene painter](../../editor/src/infrastructure/media/drawSceneFrame.ts) as video export and inspection; the obsolete duplicate video/text painter was removed. Cover capture owns and releases its font scope; the native component painter composites animated opacity as one layer. This reduces rendering-rule drift while preserving lower authored layers.
- **Replies:** [the inbox](../../editor/src/features/replies/ReplyInbox.tsx) and its CSS are co-located; [the HTTP client](../../editor/src/infrastructure/replies/client.ts) validates responses and owns transport deadlines/cancellation. [Server input, routes, repository and source hashing](../../server/replies/) are separate. Account ownership and submission quotas stay outside rendering. A 169-line inbox is a cohesive feature, although its request lifecycle is the next extraction opportunity below.

Names such as `prepareNativeBatch`, `applyAssistantChanges`, `pvoSceneMediaSource` and `captureCoverFrame` explain intent. Comments still explain non-obvious guarantees: only the matching top history state may be undone; raw frames are sent once; diagnostics cannot change an editing outcome; layer opacity must composite the whole shape. Adding comments everywhere would not improve those boundaries. Dense JSX and packed state updates remain worth expanding when touched.

### Remaining work, with current evidence

1. **Keep the original timeline and Try-session priorities.** The two timeline transaction lifecycles described above remain, and [createTrySession.ts](../../editor/src/features/preview/createTrySession.ts) is now 539 lines. Extract its transition policy and request lifetime by responsibility, preserving response/hold/cancellation behavior. The 453-line timeline gesture file and 445-line desktop visual rows are review locations, not automatic violations.
2. **Narrow the assistant session workflow.** [useAssistantSession.ts](../../editor/src/features/assistant/useAssistantSession.ts), 277 lines, owns UI/voice availability and playback restoration (lines 34–109), configures observation/font/compilation adapters inside submission (111–198), and applies results while updating thread/history/notifications (199–246). A project-scoped request workflow with explicit adapters would let the hook focus on UI lifetime. Preserve the existing task runner, fingerprint guards and atomic application boundary; do not introduce a generic assistant framework.
3. **Finish export lifecycle separation.** [ExportSheet.tsx](../../editor/src/features/export/ExportSheet.tsx), 294 lines, still combines dialog state, elapsed/ETA derivation, cover URL ownership and state-specific presentation. Its cover-save clamp at line 128 repeats [the domain cover rule](../../editor/src/domain/project/cover.ts). [ExportPreview.tsx](../../editor/src/features/export/ExportPreview.tsx), 298 lines, still owns package-media URLs, two media elements, clocks, seeking and markup. Extract those lifecycles into focused hooks and use the shared cover rule; retain the source/result animation and font regressions. The new [cover component painter](../../editor/src/features/export/paintCoverComponent.ts), lines 96–223, also specifies native component layout separately from DOM/CSS renderers. Maintain cross-renderer layout fixtures as looks evolve, sharing deterministic layout rules only where the contract is genuinely common.
4. **Extract inbox loading when extending it.** [ReplyInbox.tsx](../../editor/src/features/replies/ReplyInbox.tsx), lines 35–131, repeats abort-controller, busy/error and stale-result handling across list/open/delete while also handling account transitions. A feature-owned inbox hook would give that lifecycle one owner before pagination or further actions are added. Keep HTTP validation in the existing client and the deletion confirmation in the view.
5. **Retain the smaller ownership follow-ups.** Pure label/visibility helpers still live in `ComponentOverlay.tsx`; `legacy-view.js` still names the current Fields renderer poorly; player controllers still accept a broad mutable session; local render/reply backends still combine policy with tooling adapters. The flat Node test directory has grown to 136 files, while `sdk.test.mjs` still spans several SDK responsibilities. Group tests when their ownership changes and update discovery together, without splitting cohesive behavior suites for size alone.

The reconciled code therefore needs focused workflow cleanup, not a wholesale folder move. Single responsibility and narrower interfaces remain the main gaps; domain/adapter separation, functional grouping and meaningful names are still evident.

### Addendum verification limits

This update is a source review and documentation change. Local links and current counts were checked; no application code changed for this addendum. The initial 609-test result and import-graph counts above belong only to the historical snapshot. Separate release work exercised current PVO export, audio extraction/export, keyframe rendering, player layout/playback/fonts and cover/preview rendering in browsers. Those checks support the tested behavior, not a claim that every module is SOLID or every renderer is pixel-identical. Use the final release verification record for final check totals and deployment status.


## Implementation update

The follow-up implements the actionable findings above as focused changes. It retains feature ownership and public SDK, package, container and authoring contracts. Formatting expands previously dense JSX and statements; file length is still a responsibility-review signal rather than a quota.

| Finding | Implementation and evidence |
| --- | --- |
| Timeline transactions | Mobile clip/text timing now uses the same `beginTimelineTimingDrag` transaction as desktop. Geometry remains in feature hooks, and window/pointer cancellation has one hook. Live previews add no history; a completed drag adds one step; cancellation restores timing. Mobile's continuous trim and 0.3-second minimum remain explicit. Scene, Try and newer-history guards prevent a late release from overwriting newer state. Layer reordering now has its own transaction that restores only the original scene and preserves a new project or history entry. |
| Try session | `domain/preview/playback` owns pure boundary/eligibility rules. `createTryRequests` owns request cancellation and subscription disposal; `createTryResponses` owns response dispatch. `createTrySession` composes the session through a narrow host. Existing hold, request and scene lifecycle regressions remain. |
| Assistant | `assistantRequestWorkflow` prepares requests through explicit adapters; `assistantSessionRequest` owns project-scoped request application, feedback and cancellation. The React hook retains view/voice lifetime and playback restoration. Fingerprint guards and one atomic history update remain. |
| Export | Focused hooks own media URLs, preview playback and progress timing; state-specific components own settings, progress, result and footer rendering. The shared domain cover clamp is reused. Quality selection and URL cancellation/disposal have regression coverage. |
| Inbox | `replyInboxWorkflow` owns list/open/delete state and cancellation; `useReplyInbox` binds its lifetime to the account. Account changes clear old data, Back cancels pending reads, and deletion retains ownership until completion before navigation resumes. Confirmation stays in the view. |
| Local and hosted backends | Local render/reply folders separate routes, input, storage/jobs and transfer lifetimes. Shared reply quotas and identifiers have one owner. Hosted render routes delegate queue-failure transitions to the repository and signed internal transfers to their own adapter. Concurrent deletion rechecks the selected box inside the write queue, preventing removal of another box. |
| Shared metadata and player | Component labels/visibility live in `domain/components/presentation`. The player now names the current component host and separates Fields/manifest rendering. Playback transitions consume a narrow state adapter and pure transition policy. |
| Tests and readability | SDK cases live under `tests/sdk/`, retaining all original assertions. The Node runner discovers nested suites and bounds concurrent test files. Pinned Prettier checks an explicit adopted-file list as part of `npm run check`. The import gate now includes local server adapters and prevents their dependency on browser application internals. |
| Cover parity | Representative DOM/canvas geometry fixtures cover tooltip, card, choice and form rendering at two sizes, with authored looks and fonts. They exposed and now cover form spacing and omitted Collect replies textarea/disclosure; form and panel painters have focused owners. |

The automatic checks cover formatting and declared import directions, not every SOLID principle, cycle or domain side effect. Reviews must still assess responsibility, naming, duplication, comments and useful interfaces. There is no general-purpose JS/TS linter.

### Remaining explicit limits

- Native DOM/CSS and canvas component layouts still have distinct implementations. The representative parity fixtures are a guard against drift, not proof for every appearance or arbitrary text. A generic renderer rewrite was not required to resolve this audit.
- Player transition contracts were narrowed where the audit identified mixed policy/effects. Other cohesive controllers still use the per-viewer session; review their inputs as their responsibilities change.
- The timeline browser fixture exposed an existing desktop hit-target limitation: an outside left trim handle at time zero is clipped by the scroll viewport. The behavioral fixture positions its short layers inside visible bounds; fixing the zero-edge target requires a separate track-gutter/coordinate change. This is not claimed fixed by transaction unification.
- Large cohesive presentation, sandbox and fixture modules remain subject to review rather than arbitrary splitting. Untouched historical formatting is adopted incrementally through the explicit formatter scope.

### Follow-up validation

- `npm run check`: passed — 503 source JavaScript modules, 701 dependency-boundary modules, 107 adopted formatting files, and 1,084 Node behavior tests; none failed or skipped.
- `npm run check:editor`: passed.
- Rust formatting and 23 native behavior tests: passed. The production build, including rebuilt WASM, passed; it retains the existing large-bundle warning.
- Browser timing/stack checks passed on the completed gesture changes, including touch cancellation, Escape, blur, lost capture, unmount, snapping and Undo. Try diagnostics, native assistant application/cancellation/retries and the assistant thread passed on desktop and phone.
- Export URL/decoder lifecycle, real rendering, dialog quality selection, and 20 representative DOM/canvas cover comparisons passed. Player layout and the responsive playback/replay journey passed.
- Built-output Collect replies authoring, Try isolation, downloaded PVO submission, inbox and deletion passed against an isolated local server. The complete built desktop journey passed, including persistence/reload, Try, export and scene navigation.
- Existing browser fixtures were corrected to use persistable blob media, visible short-layer handles, and the current assistant button label. The native assistant suite was rerun successfully after concurrent WASM rebuilding had reloaded its Vite page; this is not a claim that all browser suites were run.
- Changed documentation links/anchors and source diffs were checked. Deployment status belongs to the release PRs and the task completion record; a successful local build alone is not production verification.
