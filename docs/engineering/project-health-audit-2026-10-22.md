# Restyle project health audit — 22 October 2026

## Read this first

The project needs targeted fixes, not a wholesale rewrite. Its feature folders and dependency boundaries are broadly sound. The most important problems concern saved work and data correctness, rather than file count.

**Twelve defects were confirmed through isolated reproductions or direct diagnostics.** Local fixes and regression coverage now exist for all twelve, plus the consolidation, layout and verification recommendations. The fixes are verified locally and available in the running beta. The results and remaining verification limits are recorded below.

History commits, form/format mapping, media ranges, local origins and exact-length uploads now have shared owners. Seven verified obsolete files have been removed after backup and fixture migration. Public APIs, manual process entries and fixture facades remain intentional; an entry-point-aware check guards future disconnected modules.

The original audit was read-only. Approved remediation now covers **B01–B12, C01–C05, R01 and V01–V02 locally**. Original triggers below remain historical evidence, not descriptions of the current code. No production deployment or GitHub CI result is claimed.

### Saving fixes — 22 October 2026

- **B01 fixed:** reset carries the exact project ID and the version observed by its tab. Its intent lives in tab-scoped session storage, survives immediate reload, and cannot suppress another requested project. Reset also follows a write already committing in its own tab.
- **B02 fixed:** checkpoint comparison, replacement and media collection happen in one IndexedDB transaction. A stale writer aborts before changing any project or Blob. Autosaving a different project cannot take over another tab's current-project pointer. Restoring unchanged content does not manufacture a competing saved version.
- A conflicting tab keeps its current edits in memory. The existing save-issue panel offers **Save a copy**, which saves a fresh local identity with current media and Undo/Redo history, drops cloud-task associations, and changes the route only after a successful save. A fresh identity carries the video bytes even if another tab already deleted the original project and its saved media. It does not overwrite the newer original.
- The checkpoint format remains unchanged. Version comparison uses the exact serialized checkpoint observed at restore/save, including history, rather than wall-clock timestamps alone. The coordinator owns scheduling and observed versions; `projectMarkers.ts` owns the unchanged dirty comparison; `indexedDb.ts` owns atomic storage operations.
- Eleven new isolated actual-IndexedDB scenarios pass: scoped reset, reset/reload, reset during its own write, stale scrub, stale reset, simultaneous writers, independent projects, copy recovery, copy after original deletion, media protection and unchanged restore. The real recovery button, saved copy and reopened copy pass at **393px light, 320px dark and 1280px dark**, plus recovery after original deletion at 393px. Screenshots were reviewed at all three sizes. These tests use fresh browser contexts and fixture media, never personal project storage or live AI.
- Final **1,269 Node tests**, JavaScript syntax, dependency-boundary checks, adopted formatting and strict editor types pass. Browser checks **project-saving-concurrency, project-header, preview-startup, notifications and task-project-link** pass. A Windows-only malformed `/@fs/` path in the preview-startup fixture was corrected; the app's compiler path was unchanged. The new recovery cases, project-header and task-project-link were rerun after the last media-copy change.
- The isolated **npm run build** passed. The active server on **127.0.0.1:4173**, still **PID 22020**, serves **restyle-editor-shell-4cfdba74a560b00f** in both release metadata and the service worker. All nine changed app files match the built snapshot. Generated output was backed up; old hashed assets were retained and no editing session was reloaded. The build retains its existing large-chunk warning; bundle splitting was not part of these saving fixes.

Final browser/build logs, screenshots and the previous generated output are retained at **C:/Users/yvnnl/AppData/Local/Temp/Restyle-local-dev/saving-fixes-20261022-194134/**. The earlier full five-browser pass is at **saving-fixes-20261022-193640/** in the same parent directory. The final repository check is at **saving-repository-final-20261022-194248/**. Changes remain local and uncommitted; no production or hosted-service deployment was performed.

**Release boundary:** each open Restyle tab must load the new beta to run these guards. An old tab still executing the previous JavaScript can use its old writer. No tab is forcibly reloaded. These changes protect local browser storage; they do not add cloud backup or merge conflicting edits.

## Scope and evidence

### Completed remediation — local

All report items **B01–B12, C01–C05, R01 and V01–V02** are implemented locally. Changes remain uncommitted in the existing working tree; no production service, database migration, deployment or GitHub CI run was created. Unrelated concurrent changes were preserved.

| Items | Result |
| --- | --- |
| B01–B02 | Transactional cross-tab save/reset guards and real Save a copy recovery protect project identities, history and media. |
| B03, B09 | One explicit local-origin policy and canonical media range parser; both intended local hosts work without moving browser storage. |
| B04–B05 | Project switching replaces the actual decoded footage; invalid metadata is rejected instead of inventing timing. |
| B06–B08, C02 | One form/value and format-conversion contract; replies are never silently cut off; malformed manifests return errors; player Choices honor format limits. |
| B10–B12 | Portable executable discovery, owned-transfer cleanup and preserved audio selection after Try. |
| C01, C03 | Shared history policy/guarded gesture commits and exact-length upload transport, with feature-specific rules kept in their owners. |
| C04–C05 | Obsolete capture export-format state and seven verified obsolete files removed. Fixtures now use current commands and the real copy operation. MP4 rendering, public APIs and intentional fixture facades remain. |
| R01 | Actual controls/toolbar measurements replace repeated tray sizes. Short screens preserve a reachable movie strip and preview close control; oversized controls scroll. |
| V01–V02 | Current browser assertions, isolated smoke runner, explicit scenario registry, cross-platform browser setup, source reachability and CI smoke configuration. Normal editor checking now rejects unused locals/parameters. |

### Final local verification

| Check | Result |
| --- | --- |
| Full repository check | Passed: **1,296 Node tests**, 644 JavaScript syntax checks, 863 declared dependency-boundary modules, 808 runtime-module reachability checks and 600 adopted formatted files. Nine runtime modules have intentional tool/fixture-only callers. |
| Native compiler | Passed: **23 Rust integration tests**, plus formatting and empty unit/doc targets. |
| Browser smoke | All **ten registered smoke scenarios passed**: actual IndexedDB concurrency/recovery, project header, selection dismissal, trays, keyboard/workspace, timeline keyframes, copying/reload, player switching/Choices, form boundaries and sandbox isolation. |
| Focused effect/transport checks | Passed: exported music/extracted-audio amplitude, notifications, 39 publishing/render/exact-upload cases, metadata, platform executable paths, real-store Try and gesture ownership. Actual Workers/R2 runtime covers short/long/conditional/stalled/aborted/failed streams. |
| Concurrent workspace integration | A later caller/workspace mismatch exposed missing assistant ownership. The shared workspace now owns the assistant/thread consistently. Strict editor types, unused locals/parameters, dependency boundaries and formatting pass. Trays, routed Try/simulated keyboard, and native assistant answer/edit/history/session/layout checks pass after this integration at desktop and both phone sizes. |
| Final isolated build | Passed. Backed up existing generated output, copied assets before pages/service worker and retained old hashed files. Compared **1,036 runtime source files** with the final build snapshot: no differences. |
| Live app verification | Both localhost and 127.0.0.1 return editor 200, auth/session 200, expected signed-out profile 401, assistant availability 200 and exact suffix media bytes 206. Release metadata and service worker match **restyle-editor-shell-57c1a3f78406367a**. Response bodies/credentials were not printed. |

The app remains on **port 4173, PID 23444**, serving **C:/Users/yvnnl/Projects/pvo-prototype/dist/**. The local server was restarted once to load adapter changes. No browser reload was forced; each existing tab must load **New beta release** to execute the new guards. An independently running Vite server on port 5173 was left alone.

Source and checks changed concurrently during this work. Early failing runs remain in the logs, including a corrected geometry assertion, stale browser timing assumptions and one transient esbuild process crash whose focused/full sequential retries passed. The final full repository result and subsequent workspace/type/browser/build follow-up are separate, explicitly recorded checks; they are not a claim that every unrelated edit or physical device has been exercised.

Evidence is retained outside Git under **C:/Users/yvnnl/AppData/Local/Temp/Restyle-local-dev/**:

- Full repository result: **project-repairs-verified-20261022-224139/**.
- Complete ten-scenario smoke and transport result: **project-repairs-integration-20261022-224250/**. Its final type mismatch is superseded by the follow-up below.
- Workspace/assistant integration, current strict types and build result: **project-repairs-completion-20261022-225132/**.
- Final build and previous generated output backup: **project-repairs-build-20261022-225235/**.
- Final live/source/release evidence: **project-repairs-final-proof.json** and **project-repairs-built-source-comparison.json**.
- Deleted-source backup: **removed-source-20261022-220830/**. Earlier audit, focused-test and screenshot logs are retained.

CI is configured to install its browser and run the isolated smoke gate after the build. It has **not been run on GitHub**. Physical phone keyboards/gestures, live provider sign-in/inference and production infrastructure remain outside this local verification. The build retains its existing large-chunk advisory; removing unreachable source does not imply an equivalent download-size reduction.

### Original audit scope

- Audited the actual working copy at C:/Users/yvnnl/Projects/pvo-prototype, including pending and untracked source, on branch **fix/mobile-full-conversation**, HEAD **7583d1a215c0d96c49ad0584b97d76dadac4c6a1**. This is not an assessment of a clean dev checkout or a production release.
- Reviewed editor, player, shared packages, backend, local adapters, tooling, CI and previous audits. Three independent read-only reviewers covered editor, backend, and player/packages; the coordinator reviewed tooling, references and selected reproductions.
- Excluded generated dist, node_modules, Cargo target, WASM pkg and Wrangler state from source analysis. No credentials or private local configuration were read.
- Used conservative TypeScript-AST import tracing, exact function-body token comparison, stricter unused-local checks, manual caller tracing and behavior checks.
- Storage reproductions used actual IndexedDB in fresh isolated Chromium storage, bundled source and an intercepted empty fixture page. They did not use the running app's project storage.
- Other reproductions used real exported modules, existing WASM, or exact source fragments with fake requests, ports and clocks. A simulated ownership race is distinguished from a reproduced operating-system crash.
- This audit performed no application rebuild, deployment, forced reload, live AI inference or cloud-account write. The app process stayed **PID 22020, port 4173**. Its initial revision was **restyle-editor-shell-fd0f91ccc8708fa5**.

**Concurrent-work note:** baseline evidence began at 16:33 BST. By the final reference check at approximately 16:51 BST, other work had changed scene/settings/account/desktop presentation files, deleted DesktopEditorHeader.tsx, and refreshed the local beta to **restyle-editor-shell-29003f05686db1d8**. These were not changes made by this audit. The twelve defect mechanisms were rechecked and were present at that reference check. Inventory metrics and the original test results describe their earlier inspected snapshots; they are not a test certification of the concurrent changes. Later saving remediation is recorded separately above.

### Checks run during the original audit

| Check                                                         | Result                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| npm run check                                                 | Passed: JavaScript syntax, declared dependency boundaries, adopted-file formatting and all **1,269 Node tests**       |
| npm run check:editor                                          | Passed                                                                                                                |
| npm run check:language                                        | Passed: **23 native Rust integration tests**, plus empty unit/doc targets                                             |
| npm run check:language:format                                 | Passed                                                                                                                |
| Editor browser: tool-trays, editor-motion                     | Passed                                                                                                                |
| Player browser: restyle                                       | Passed across responsive light/dark player flows                                                                      |
| Runtime browser: isolation                                    | Passed                                                                                                                |
| Editor browser: selection-dismissal                           | **Failed** at line 35 waiting for the former Collapse control; its component-toolbar and sheet expectations are stale |
| Extra TypeScript flags: noUnusedLocals and noUnusedParameters | **Failed with three unused declarations/parameters**, listed under C05                                                |
| Read-only local API diagnostics                               | Confirmed localhost auth 400 / assistant status 403; canonical loopback auth 200                                      |

Passing tests do not cover the newly reproduced defects. The stale browser check is a verification problem, not proof that the app should restore a removed button.

Evidence logs, inventory and diagnostic output are retained locally at:

**C:/Users/yvnnl/AppData/Local/Temp/Restyle-local-dev/project-audit-20261022-163311/**

Parent tools in the enclosing Restyle-local-dev directory are ProjectAuditChecks.ps1, ProjectAuditInventory.cjs, ProjectAuditExtraChecks.ps1 and ProjectAuditDiagnostics.mjs. These machine-local artifacts are outside Git and may not travel with this report. Reviewer-specific in-memory reproductions are described below; they are observations, not checked-in regression tests.

## Priorities and fix order

P1 means address first because stored work or a core workflow is affected. P2 means a confirmed correctness issue with a narrower trigger. P3 means maintenance. A **risk** is explicitly separate from a reproduced bug.

| Order | IDs          | Work                                                           | Completion condition                                                                     |
| ----- | ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1     | B01–B02      | Cross-tab save/reset ownership                                 | Actual IndexedDB tests prove another tab cannot overwrite or delete unrelated/newer work |
| 2     | B03–B04      | Local origin policy and player media identity                  | Intended local addresses work; successive projects show their own footage                |
| 3     | B05–B08      | Import metadata and format/form boundaries                     | No invented timing, silent truncation, validator exceptions or player/editor limit drift |
| 4     | B09–B12      | Media delivery, Windows executables, cleanup and Try selection | Focused adapter/store regressions pass                                                   |
| 5     | V01–V02      | Browser and unused-code checks                                 | Current flows run in CI with explicit browser configuration and meaningful discovery     |
| 6     | R01, C01–C05 | Consolidate ownership and remove verified leftovers            | Small changes with parity checks, without parallel replacement abstractions              |

Fix the data-loss paths before restructuring them. Do not start by moving every large file or deleting everything without an app importer.

## Original defects and remediation

### B01 — P1: Resetting one tab can delete a different saved project

**Current fix owners:** [sessionActions.ts](../../editor/src/state/project/sessionActions.ts), [discardMarker.ts](../../editor/src/infrastructure/projectPersistence/discardMarker.ts), [persistence/index.ts](../../editor/src/infrastructure/projectPersistence/index.ts), [indexedDb.ts](../../editor/src/infrastructure/projectPersistence/indexedDb.ts).

**Original defect:** the discard marker was a global boolean. During an anonymous reset save, the writer chose the named project to delete from the database's global current checkpoint, rather than the identity of the project being reset.

**Reproduced:** A owns project A; B saves project B last; A resets and its empty state saves. Actual IndexedDB reports **projectAExists: true; projectBExists: false**. B's media also becomes eligible for collection. The global discard check can additionally suppress restoration of an unrelated requested project.

- [x] Carry the exact discarded project ID/session ownership through the reset and write transaction. Scope the marker to that identity; never infer deletion authority from another tab's last save.
- [x] Regression: two persistence instances, different projects, B saved last, reset A. Preserve B and its media; discard only A.

### B02 — P1: A stale tab can overwrite newer edits just by scrubbing

**Current fix owners:** [persistence/index.ts](../../editor/src/infrastructure/projectPersistence/index.ts), [checkpointVersion.ts](../../editor/src/infrastructure/projectPersistence/checkpointVersion.ts), [indexedDb.ts](../../editor/src/infrastructure/projectPersistence/indexedDb.ts), [projectAutosave.ts](../../editor/src/app/projectAutosave.ts).

**Original defect:** selection and paused playhead changes triggered autosave of the whole checkpoint. The writer unconditionally replaced the current and named records without checking a persisted revision.

**Reproduced with the normal 800ms debounce:** A saves “New title from A” and “New content from A.” Stale B only moves its paused playhead to 1. Stored title/content revert to the originals, with time 1. Old Undo history is written too; asset collection can compound the loss.

- [x] Add transactional compare-before-write using a persisted revision. Preserve a conflicting tab's unsaved work and provide a recovery/reload/copy decision. Locks or notifications can help but must not replace the transactional check.
- [x] Regression: A edits; stale B selects/scrubs; A's content, history and referenced media remain intact.

### B03 — P1: The current localhost address breaks local AI and sign-in

**Local remediation:** [Shared local-origin policy](../../scripts/dev/local-origins.mjs) accepts matching localhost/127.0.0.1 hosts at the configured port, rejects mismatches/forged hosts, and preserves the explicit public HTTPS assistant case. Existing project storage stays on its origin. Actual-host auth/profile/assistant tests and live signed-out/status probes pass.

**Where:** [server.mjs](../../scripts/dev/server.mjs), [assistant.mjs](../../scripts/dev/assistant.mjs), [assistant.mjs](../../scripts/dev/assistant.mjs), [local-auth.mjs](../../scripts/dev/local-auth.mjs), [account-profile.mjs](../../scripts/dev/account-profile.mjs).

Static pages load at http://localhost:4173, but the adapters are configured for http://127.0.0.1:4173 and reject the other Host/Origin. The current browser uses localhost.

**Live read-only diagnostics:** localhost GET /api/auth/session → **400**; canonical loopback session → **200**; localhost GET /api/assistant/status → **403**. Response bodies were discarded. Stub tests also confirmed localhost assistant POSTs are rejected before reaching the provider; no real inference was sent.

- [x] Share one explicit policy for intended loopback aliases and the configured port, retaining matching Host/Origin and forged-host rejection. Preserve the documented public HTTPS-origin case.
- [x] Do not silently redirect the editor to a different origin: existing browser projects belong to their original origin.
- [x] Regression: auth/session/exchange/logout/profile and assistant availability/turn on both intended addresses, plus mismatched-origin and forged-host rejection.

### B04 — P1: Opening another PVO can keep the previous project's footage

**Local remediation:** [Video source ownership](../../player/media/project.js) detaches the old decoder before URL revocation; [the controller](../../player/media/video.js) compares the resolved URL too. Actual sequential PVO loading verifies changed decoded frames, duration, geometry and URL despite identical asset IDs.

**Where:** [video.js](../../player/media/video.js), [project.js](../../player/media/project.js), [project.js](../../player/media/project.js).

The player caches media using only video.dataset.assetId. Replacing a project revokes its object URLs and replaces the asset map but leaves that cached ID. Different projects commonly reuse IDs such as “video” or “main.”

**Reproduced with the real controller and an EventTarget video port:** A loads blob:project-A; B replaces the map under the same ID; loadClip(0) leaves A's source and does not call load() again. The retained source may also reference a revoked URL.

- [x] Scope identity to the project and actual resolved URL; reset/detach the old source during replacement.
- [x] Regression: sequentially open projects with identical asset IDs but different footage. Verify source, decoded frame and duration switch.

### B05 — P2: Unknown source duration silently becomes three seconds

**Local remediation:** [Metadata discovery](../../editor/src/infrastructure/media/readVideo.ts) rejects unknown duration or dimensions with a retry/export message. Finite/invalid/timeout/abort/decoder-cleanup tests pass; no placeholder timing is saved.

**Where:** [readVideo.ts](../../editor/src/infrastructure/media/readVideo.ts), [useProjectMedia.ts](../../editor/src/features/create-project/useProjectMedia.ts), [videoImport.ts](../../editor/src/features/capture/videoImport.ts).

Infinite or NaN metadata is replaced with duration 3, then used as real source duration and the clip out point. Missing width and height are individually replaced with 9 and 16, potentially inventing source geometry too.

**Reproduced with a decoder stub:** a metadata event carrying infinite duration returns duration 3 with otherwise valid 1920×1080 dimensions. Whether a particular real file triggers it depends on its browser metadata. The trim/export limit is fabricated rather than discovered.

- [x] Use bounded metadata/duration discovery or reject with a useful retry path. Do not substitute placeholder timing for source data.
- [x] Regression: finite, infinite, NaN, zero and missing-dimension metadata, plus timeout and abort.

### B06 — P2: Compiled forms silently truncate replies at 500 characters

**Local remediation:** [Shared form policy](../../packages/pvo-sdk/runtime/form-values.js) sets one 1,024-character boundary. [Rendered collection](../../packages/pvo-code-runtime/rendered-form-values.js) preserves invalid text, exposes validation and prevents dispatch. Native/compiled browser checks pass at the boundary and after correction.

**Where:** [session.js](../../packages/pvo-code-runtime/session.js), [render.rs](../../packages/pvo-language/src/compiler/render.rs), [form-values.js](../../player/actions/form-values.js), [fields-view.js](../../player/components/fields-view.js), [forms.ts](../../editor/src/domain/components/forms.ts).

The sandbox form path slices submitted strings to 500 characters without visible validation. Generated inputs have no matching maximum, while native/editor form paths permit 1,024 characters.

**Reproduced with the exact form-fields function:** a 700-character reply becomes 500 characters without an error.

- [x] Establish one shared limit/normalization contract and enforce it visibly at the input and submission boundary. Avoid silent truncation.
- [x] Regression: 500, 501, 700, 1,024 and over-limit replies through compiled and native forms.

### B07 — P2: The public validator throws on malformed collections

**Local remediation:** [Manifest shape preflight](../../packages/pvo-sdk/manifest/shapes.js) validates collections/members before traversal; branch cases are guarded too. Malformed JSON-compatible shapes return errors instead of throwing.

**Where:** [validate.js](../../packages/pvo-sdk/manifest/validate.js), [validate.js](../../packages/pvo-sdk/manifest/validate.js), [validate.js](../../packages/pvo-sdk/manifest/validate.js), [public declaration](../../packages/pvo-sdk/index.d.ts).

The public contract accepts unknown input and returns validation results. Some shape errors are recorded, but later passes still iterate malformed collections or dereference null members.

**Reproduced with the exported validator:** object-shaped scenes and components throw TypeError rather than returning invalid results. Reviewer tests also exercised invalid media, null components and object-shaped form fields.

- [x] Narrow collection/member shapes before dependent traversal. Subsequent passes must use only validated collections.
- [x] Regression: invalid JSON-compatible shapes consistently return an invalid result with errors, without throwing.

### B08 — P2: The player imposes an editor-only two-choice limit

**Local remediation:** [Player language interpretation](../../player/components/language.js) honors format-valid Choice counts. Actual packaged two/three/four-option Choices display and execute. Editor two-option authoring policy stays in the editor.

**Where:** [language.js](../../player/components/language.js), [validation.rs](../../packages/pvo-language/src/structure/validation.rs), [validate.js](../../packages/pvo-sdk/manifest/validate.js).

The format/compiler supports two to four Choice options; the editor intentionally authors two. The standalone player incorrectly rejects compiled Choices with other valid counts, with an error saying “in this editor.”

**Reproduced with existing WASM:** a three-option Choice compiles, then the actual player reader rejects those same source blobs.

- [x] Keep editor product limits in editor/assistant policy. Let the player honor the format/compiler contract.
- [x] Regression: packaged compiled Choices with two, three and four options load and execute; preserve intentional two-option editor authoring.

### B09 — P2: The local media server returns the wrong suffix bytes

**Local remediation:** [Local media responses](../../scripts/dev/media-response.mjs) reuse the canonical range policy. Actual HTTP header/byte tests pass, including suffix ranges; the refreshed live server returns the exact final four bytes on both local hosts.

**Where:** [server.mjs](../../scripts/dev/server.mjs); correct shared policy: [range.js](../../server/viewing/range.js).

Local media delivery duplicates byte-range parsing and treats an omitted start as zero.

**Exact-source stub reproduction with a 1,000-byte file:** bytes=-4 returns bytes 0–4 instead of the final four bytes, 996–999. An empty bytes=- range receives a full 206 response instead of 416. Browser playback failure was not separately reproduced.

- [x] Reuse the canonical byte-range policy, retaining separate Node/Worker response effects.
- [x] Regression: suffix, normal, open-ended, malformed, empty and oversized ranges; verify headers and actual bytes.

### B10 — P2: Windows FFmpeg configuration misses adjacent FFprobe

**Local remediation:** [Executable resolution](../../scripts/dev/render-jobs/executables.mjs) handles Windows/POSIX sibling paths, relative paths, bare commands and explicit overrides. Platform/path regression cases pass.

**Where:** [jobs.mjs](../../scripts/dev/render-jobs/jobs.mjs).

Sibling discovery checks only for a forward slash. Given PVO_FFMPEG_PATH=C:\Tools\FFmpeg\bin\ffmpeg.exe, it chooses bare ffprobe from PATH rather than the adjacent executable. A custom installation can fail unless FFprobe is separately configured or already on PATH.

**Confirmed from the exact path expression.** The current machine's private configuration was not inspected.

- [x] Handle platform path separators and executable names; preserve bare-command PATH lookup and explicit overrides.
- [x] Regression: backslashes, forward slashes, relative and macOS paths, bare commands and explicit FFprobe overrides.

### B11 — P2: Job expiry can delete files during an active upload

**Local remediation:** [File ownership](../../scripts/dev/render-jobs/ownership.mjs) covers upload/render/download owners; cancellation, expiry and shutdown await settlement before idempotent removal. Cleanup failures are observed. Held-transfer and feature lifecycle regressions pass.

**Where:** [jobs.mjs](../../scripts/dev/render-jobs/jobs.mjs), [jobs.mjs](../../scripts/dev/render-jobs/jobs.mjs), [transfers.mjs](../../scripts/dev/render-jobs/transfers.mjs), [transfers.mjs](../../scripts/dev/render-jobs/transfers.mjs).

Expiry aborts a job and deletes it whenever its status is not rendering, without waiting for active uploads. Explicit cancellation already has safer transfer-ownership handling.

**Exact-source fake-clock reproduction:** an expired uploading job reaches deletion while activeUploads remains 1. Windows filesystem failures are a risk from that race, not a separately demonstrated crash.

- [x] Route expiry and shutdown through the shared cancellation/ownership lifecycle. Observe cleanup rejections; remove files only after owners release them.
- [x] Regression: pause an upload, expire/cancel/close, then finish the transfer. Remove once, after settlement.

### B12 — P2: Leaving Try loses extracted-audio selection

**Local remediation:** [Try session capture](../../editor/src/features/preview/createTrySession.ts) and its host carry audio selection. Actual-store checks cover normal exit, scene routing and deleted targets.

**Where:** [createTrySession.ts](../../editor/src/features/preview/createTrySession.ts), [createTrySession.ts](../../editor/src/features/preview/createTrySession.ts), [trySessionHost.ts](../../editor/src/features/preview/trySessionHost.ts), [sceneSync.ts](../../editor/src/state/project/sceneSync.ts).

The saved edit-location contract includes clip/text/component selection but omits audio. Restoring the other fields causes actual scene synchronization to clear the audio selection.

**Reproduced with the real store and Try session:** selected audio 2 before Try, 2 during Try, null after stopping, without routing. Existing preview-session tests use an Object.assign-style patch stub that bypasses this normalization.

- [x] Include audio selection in the edit-location/host contract.
- [x] Regression: actual-store Try entry/exit with extracted audio, routed scenes and deleted targets.

## Original consolidation findings

### R01 — P2 risk: Tray geometry has multiple sources of truth

**Local remediation:** The [existing geometry owner](../../editor/src/features/editor-layout/workspaceGeometry.ts) uses observed controls/toolbar height. Short screens give navigation space to a usable timeline, retain the preview close control and scroll oversized controls. Phone light/dark, desktop, small phone, landscape, larger text, safe-area, multiple-track and simulated keyboard checks pass; physical keyboards remain an explicit limit.

**Where:** [EditorToolDock.tsx](../../editor/src/features/tool-trays/EditorToolDock.tsx), [ToolTray.module.css](../../editor/src/features/tool-trays/ToolTray.module.css), [ToolRow.module.css](../../editor/src/features/timeline/ToolRow.module.css), [EditorWorkspace.tsx](../../editor/src/features/editor-layout/EditorWorkspace.tsx).

Tray heights 106/190/146/96 are specified in JavaScript; several repeat as CSS minimum heights. Toolbar height is 76px plus safe-area in CSS; workspace arithmetic independently subtracts 76 and reserves fixed timeline space.

This is confirmed coupling, **not a claim that today's tested viewport is broken**. Content, fonts, safe areas or toolbar changes can update one side and invalidate the other.

- [x] Give actual measurements to the existing layout owner, or share CSS variables where measurement is unnecessary. Keep minimum usable timeline rules explicit.
- [x] Check small phones, landscape, large text, safe areas, multiple tracks, keyboard opening and every tray.

### C01 — P3: Share history commits and the forty-entry limit

**Local remediation:** [Pure history policy](../../editor/src/domain/project/history.ts) owns the forty-entry limit; [guarded gesture commits](../../editor/src/state/project/history.ts) share identity/history/scene ownership checks. Feature math stays with its feature. Forty-three focused gesture/history checks pass.

Manual snapshot append/truncate/clear-redo logic appears in [captureStore.ts](../../editor/src/state/captureStore.ts), [animation/gesture.ts](../../editor/src/state/animation/gesture.ts), [timelineTimingDrag.ts](../../editor/src/state/editing/timelineTimingDrag.ts), [overlayTransform.ts](../../editor/src/state/editing/overlayTransform.ts), [audioCommands.ts](../../editor/src/state/editing/audioCommands.ts), [layerReorderDrag.ts](../../editor/src/state/editing/layerReorderDrag.ts), [componentTimingDrag.ts](../../editor/src/state/components/componentTimingDrag.ts) and [componentLayerGesture.ts](../../editor/src/state/components/componentLayerGesture.ts).

- [x] Share one history limit and one guarded commit operation. Consolidate common transaction ownership/commit/cancel rules while retaining feature-specific math.
- [x] Verify one Undo per committed gesture, none for cancellation, and no rollback of newer project/scene changes.

Forty can be a reasonable deliberate policy; independent implementations are the maintenance problem.

### C02 — P3: Share pure format mapping, not editor restrictions

**Local remediation:** [Pure component conversion](../../packages/pvo-sdk/manifest/component-values.js) and [form normalization](../../packages/pvo-sdk/runtime/form-values.js) are shared by exporter/player/runtime. Current renderer and package parity checks pass. Editor product restrictions remain separate.

[Player language mapping](../../player/components/language.js) repeats outcome and compiled form/choice/card conversion from [editor actions](../../editor/src/domain/components/actions.ts) and [export manifest mapping](../../editor/src/domain/export/manifest.ts). Field normalization repeats in [editor fields](../../editor/src/domain/components/fields.ts) and related helpers.

- [x] Extract pure format conversion/normalization into a small package API with exporter/player parity tests.
- [x] Keep editor-only controls and limits separate. B06 and B08 show existing drift; avoid another parallel translation layer.

### C03 — P3: Share exact-length storage-upload plumbing

**Local remediation:** [Exact-length transport](../../server/storage/exact-upload.js) owns producer/storage cancellation and conditional streaming writes. Publication/job authorization and metadata remain in their features. Actual Workers/R2 exact/short/long/stall/abort/conditional/source/storage cases and 39 feature-adapter checks pass.

[Publishing upload](../../server/publishing/upload.js) and [render storage](../../server/render-jobs/storage.js) independently implement body-length checks, fixed-length streams, timeout/abort, conditional writes and cleanup.

- [x] Extract the narrow transport primitive. Keep metadata, publication reservations, job authorization and transaction policy with their features.
- [x] Preserve short/long body, abort, timeout, conditional-write and storage-failure behavior.

### C04 — P3: Remove obsolete export-format state

**Local remediation:** Obsolete capture/resume export-format choice is removed. Checkpoint restore narrows to current fields. PVO remains the UI path; MP4 rendering and assistant media-export effect contracts retain current callers. Fifty-seven focused persistence/assistant/export checks pass.

[Capture state](../../editor/src/state/types.ts) and [checkpoint shape](../../editor/src/infrastructure/projectPersistence/checkpoint.ts) retain video/PVO choices although [current export UI](../../editor/src/features/export/ExportSheet.tsx), history and scene synchronization force PVO.

- [x] Trace and remove/narrow the obsolete choice and persistence plumbing.
- [x] Preserve MP4 rendering used to produce PVO media: an unused format selector does not make the renderer unused.
- [x] Verify export, checkpoint restoration, assistant export requests and media rendering.

### C05 — P3: Remove disconnected UI; decide test-only APIs

**Implemented locally.** Caller tracing preceded deletion. Seven obsolete files were backed up under **C:/Users/yvnnl/AppData/Local/Temp/Restyle-local-dev/removed-source-20261022-220830/** and removed:

| Removed file | Reason and replacement |
| --- | --- |
| MediaPanel.tsx and MediaPanel.module.css | No callers; current media library remains in use. |
| PanelResizeHandle.tsx | No callers; live workspace/debug resize owners remain. |
| outcomeName.ts | No remaining caller. |
| state/editing/animationCommands.ts | Tests migrated to current [animation commands](../../editor/src/state/animation/commands.ts). |
| state/editing/audioGainCommands.ts | Node/browser tests migrated to current authoring commands and gestures, including percentage values and animated gain tracks. |
| projectPersistence/copyProject.ts | Browser coverage now uses the real [Save a copy operation](../../editor/src/app/projectAutosave.ts), preserving history/media and removing task associations. |

DesktopEditorHeader.tsx had already been deleted by concurrent work; it was not recreated. The state facade [store.ts](../../editor/src/store.ts), [text catalog facade](../../editor/src/features/text/catalog.ts), public SDK exports and pure checkpoint-copy policy retain intentional fixture/public callers. These were not deleted based on app-only reachability.

Removed the unused PvoLanguageStructure import, DesktopPlayer clips subscription and ExportFooter format parameter found in the audit. A later strict pass found nine unused timeline names, also removed without changing editing behavior. Current command tests, real exported-audio amplitude tests and actual copy/reload coverage pass. Final aggregate and follow-up verification are recorded above.

## Original verification findings

### V01 — P2: Green default checks do not establish browser confidence

**Local remediation:** [The browser smoke runner](../../scripts/checks/smoke.mjs) owns a temporary source server and fixtures; [CI](../../.github/workflows/check.yml) installs matching Chromium explicitly. Saving, current editor controls, tray/keyboard layout, keyframes, copying, player switching, forms and isolation are registered. All ten smoke scenarios pass locally; configuring CI does not establish a GitHub run.

[CI](../../.github/workflows/check.yml) builds and runs Node, Rust, formatting and TypeScript, but no browser workflow. The cross-tab and actual-store Try bugs are missing scenarios despite green default checks.

[selection-dismissal.mjs](../../scripts/checks/editor/selection-dismissal.mjs) fails waiting for a former control. Later assertions still expect a Speed dialog, a “2x” label and older component behavior.

- [x] Update the check to the intended UI; do not restore removed controls just to satisfy stale assertions.
- [x] Add an isolated browser CI smoke gate for persistence, key editor flows, player switching and renderer isolation. Configure Chrome explicitly; mock or locally fixture account/cloud effects.
- [x] Use actual store normalization where simplified patch fakes currently hide boundary behavior.

### V02 — P3: Consolidate browser bootstrap and discovery

**Local remediation:** [Shared browser bootstrap](../../scripts/checks/helpers/browser.mjs), [scenario registry](../../scripts/checks/browser-checks.json) and [module reachability](../../scripts/checks/unused.mjs) replace platform paths, indiscriminate discovery and app-only scans. Resolution/failure-cleanup/root regressions pass. Reachability is conservative module analysis, not proof that every export is needed.

[run.mjs](../../scripts/checks/run.mjs) treats every top-level suite .mjs file as a check, including helper-only assistant-fixture.mjs and supabase-fixture.mjs.

The scan of 123 top-level browser-suite files found defaults appearing Windows-only in 66, Mac-only in 28 and platform-aware in seven; 22 were not classifiable by that simple scan. These are portability indicators, **not failure counts**. Examples: [selection-dismissal.mjs](../../scripts/checks/editor/selection-dismissal.mjs), [editor-motion.mjs](../../scripts/checks/editor/editor-motion.mjs).

- [x] Share executable resolution, environment overrides and fixture lifecycle; keep scenario assertions separate.
- [x] Register actual checks explicitly or move helpers out of discovery. Fail clearly for missing prerequisites.
- [x] Add entry-point-aware unused-code checking with roots for fixtures, public APIs, workers, build scripts and HTML assets. Unused-local flags alone cannot find disconnected exported modules.

## Is the code bloated?

The inventory covered 1,400 source/asset files, including 1,251 code files and 827 non-test JavaScript/TypeScript runtime modules. Counts include declarations and package-native tests and are not directly comparable to narrower old audits.

| Area                              | Code files | Lines including blanks |
| --------------------------------- | ---------: | ---------------------: |
| Editor                            |        593 |                 52,049 |
| Player                            |         41 |                  3,345 |
| Server                            |        103 |                  7,591 |
| Packages                          |        110 |                  9,754 |
| Scripts, including browser checks |        212 |                 37,616 |
| Node tests                        |        192 |                 33,357 |

The analyzed graph contained **no static runtime import cycles**, and the exact-body scan found **no cross-file duplicates above its 12-line/350-character threshold**. This does not prove there are no computed cycles, similar algorithms or repeated business rules. Semantic duplication above matters more than token-identical copying.

Large files are review locations, not automatic violations:

| File                                                                   | Lines | Assessment                                                                                                       |
| ---------------------------------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------- |
| packages/pvo-assistant/native/schema.js                                |   724 | Cohesive schema ownership may justify size; split only independent concerns while preserving its public contract |
| editor/src/infrastructure/assistant/runNativeTask.ts                   |   559 | Review workflow ownership while preserving cancellation and repair/verification behavior                         |
| editor/src/features/desktop-editor/timeline/DesktopVisualLayerRows.tsx |   494 | Review repeated layer wiring; preserve shared editing commands and distinct geometry                             |
| packages/pvo-code-runtime/session.js                                   |   466 | B06 is a concrete reason to isolate form-value policy from session effects                                       |
| editor/src/domain/export/manifest.ts                                   |   460 | Extract shared mapping under C02 rather than splitting arbitrarily                                               |

Keep tests expressive even when long. The largest files overall include browser scenarios and behavior tests; their length is not equivalent to shipping application bloat.

## What should stay

- Public SDK exports are not dead just because this repository has no runtime caller; external consumers and packaged content may use them.
- Native and compiled component renderers both have current callers.
- Examples, migrations and build scripts have manual/tool entry points rather than ordinary app imports.
- The state facade supports fixtures; generated bindings, compiler caches and dependencies are not abandoned source.
- Retained hashed dist assets support open editor sessions. Do not purge them or dependency folders while the app needs them.
- Editor and player have intentional product differences. Share pure format rules rather than every view or environment adapter.

## Older audit reconciliation

Earlier audits remain historical evidence, not a current deletion list:

- Manifest-only forms now have a native field-validation path; the old “compiled Structure required” bug is resolved.
- Component presentation rules now live in their domain owner rather than a preview renderer.
- Clip/text timing uses the shared timing transaction; do not repeat the old finding as if that work had not happened.
- Local render/reply adapters are already grouped by feature; the remaining issues are narrower than another folder reorganization.

## Completed implementation batches

1. **Protect saved work:** B01–B02, with actual IndexedDB concurrency regressions first.
2. **Restore core local/player flows:** B03 and B04 in separate small changes.
3. **Correct media/format contracts:** B05–B08; share form normalization only where a pure package contract is justified.
4. **Fix adapter edge cases:** B09–B11 and their existing shared primitives.
5. **Restore Try context and test confidence:** B12, V01–V02.
6. **Reduce maintenance debt:** C01–C05 and R01, one responsibility at a time with before/after checks.

For each batch: preserve pending work, name/open affected files before editing, add the missing regression and run relevant checks. Rebuild/refresh the local beta only when application code changes. The source fixes, regression evidence and running beta verification above establish completion of these batches.

## Limits

This is a broad working-tree audit, not proof that every path is bug-free. Not every browser check, physical-device keyboard/gesture combination, malformed package or distributed failure was executed. Live Supabase/Runpod behavior and production infrastructure were not exercised. No dependency installation or mass cleanup was needed. References and metrics describe this snapshot and should be rechecked when applying fixes.
