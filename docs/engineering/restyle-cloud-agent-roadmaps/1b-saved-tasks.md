# Roadmap 1B implementation plan: the agent's saved notebook

[Task checkboxes](01-first-working-component.md#1b-save-the-task-and-its-questions) · [Current checkpoint](../restyle-cloud-agent-progress.md) · [Handoff](../restyle-cloud-agent-handoff.md)

**Plain-English result:** Restyle remembers what you asked it to build, what it has already done, and what answer it needs from you. Closing the editor does not erase the task. Returning to it resumes the same work.

**This milestone is verified complete.** Shared records, local association, owned storage/planning, native handoff, task UI, guarded results and provider reconciliation pass the acceptance matrix below. The [live recovery proof](../restyle-cloud-provider-recovery-proof.md) and progress log record exact source/resources/cleanup. PR integration and production release are separate from this verification.

## First useful change

Completed **1B.01: the shared task record and its rules** answers: “What is a valid saved task, and what changes are allowed?” Its pure functions and tests need no cloud deployment or UI. The record carries trusted owner metadata, a server project identity, and the original project fingerprint.

The local project association in **1B.02** is also complete. **1B.03** now resolves owned server projects and preserves real tasks across storage restart. The saved runner in **1B.05** is now verified. **1B.04/1B.06** request routing and task presentation and **1B.07** result application are also complete. The **1B.08/1B.09** provider journal and reconciliation are also verified; next is **1C.01**. Prove each layer through its public boundary before connecting the next.

## Suggested source ownership

Use these locations after checking the current branch. The shared task module exists; the other new names are proposals. Create files only when implementing their responsibility.

| Responsibility | Existing code to inspect | Proposed home for new code |
| --- | --- | --- |
| Shared task input, output, validation, pure transitions | [assistant package](../../../packages/pvo-assistant/native/index.js) and [types](../../../packages/pvo-assistant/native/index.d.ts) | Implemented: [tasks public entry point](../../../packages/pvo-assistant/tasks/index.js) and [contract](../../../packages/pvo-assistant/tasks/README.md) |
| Authentication and route guards | [account sessions](../../../server/auth/sessions.js), [reply routes](../../../server/replies/routes.js), [HTTP helpers](../../../server/http.js) | `server/assistant/tasks/routes.js`; thin entry wiring |
| Saved task and step storage | [assistant budget object](../../../server/assistant/budget.js), existing repository adapters | Focused storage/coordinator modules beside the task routes |
| Background authoring loop | [current model workflow](../../../server/assistant/native/service.js), [budget reservation](../../../server/assistant/quota.js) | Task runner and effect adapters, separate from HTTP and domain rules |
| Local project association | [local persistence](../../../editor/src/infrastructure/projectPersistence/index.ts), [project sessions](../../../editor/src/state/project/sessionActions.ts) | A focused project/task link through the existing persistence commands |
| Task HTTP transport | [native transport](../../../editor/src/infrastructure/assistant/nativeTransport.ts) | A separate task transport adapter |
| Task presentation | [assistant session](../../../editor/src/features/assistant/useAssistantSession.ts), [thread store](../../../editor/src/state/assistant/threadStore.ts) | Focused task views/hooks under the assistant feature |
| Safe component application | [native commands](../../../editor/src/state/assistant/nativeCommands.ts), [request workflow](../../../editor/src/features/assistant/assistantRequestWorkflow.ts) | Reuse existing fingerprint/history guards through named commands |

Shared task rules must not import React, Zustand, editor stores, Worker bindings, or network APIs. Server effects must not import editor internals. Do not turn the current assistant routes or thread store into the entire task system.

## 1B.01 — Define the record and legal changes

Implemented through `packages/pvo-assistant/tasks/index.js` and `index.d.ts`. The [contract guide](../../../packages/pvo-assistant/tasks/README.md) records the exact API, field bounds, and adapter obligations; use that single current contract when implementing the following layers.

| Information | Purpose and rule |
| --- | --- |
| Task identity | Trusted adapter supplies a stable ID; duplicate-create validation compares owner, creation key, digest, and actual input. Atomic lookup/creation belongs to storage |
| Owner | Separate trusted metadata; future routes derive it from the authenticated server session, never a caller's input fields |
| Project identity | Links to an owned project association; a local numeric project ID alone is not globally unique |
| Request and examples | Original goal and expected behavior cases saved before code generation |
| Bounded context | Component/source context and project fingerprint required for the task; no whole-video upload by default |
| State and step | Saved state plus the next resumable step; state is distinct from the text shown in the UI |
| Questions and answers | Immutable question IDs/prompts, revision 0 before an answer and 1 afterward, duplicate-answer keys; corrections use a new question |
| Step receipts | Operation ID, input digest, outcome, artifact/provider references, and whether reconciliation is needed |
| Prepared result | Bounded artifact reference and original project fingerprint; artifact validation, persistence, and editor application follow later |
| Revision and execution ownership | Monotonic revision and a claimed execution generation so an old worker cannot commit after Stop or takeover |
| Bounds and timestamps | Created/updated times, retry count, deadline, next wakeup, and usage reservations |
| Errors | Sanitized operation context and a useful recovery classification; secrets and private payloads stay out |

Byte/count limits for every variable-length field and collection, deadline, retention, retry count, and usage reservations are fixed in `TASK_LIMITS` and explained in the contract guide. These include 128 KiB input, 256 KiB task records, a 24-hour build deadline, and seven-day retention from creation. Storage/coordinator code must enforce the associated expiry and deletion policy. The 1A fixture's 20 calls and 60 seconds remain diagnostic limits.

Implemented states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `queued` | Waiting for its next run | `running`, `stopped`, or deadline expiry to `failed` |
| `running` | A current execution claim owns a step | `queued`, `waiting_for_answer`, `ready`, `failed`, `stopped` |
| `waiting_for_answer` | A question needs the creator | `queued` after a valid answer, `stopped`, or deadline expiry to `failed` |
| `ready` | A validated result is saved for the editor | Terminal for this build attempt |
| `failed` | Work stopped with a recorded reason | `queued` after explicit resume of a recoverable failure within its bounds, or `stopped` |
| `stopped` | Creator cancelled further work | Terminal; continuing creates a new linked attempt if needed |

Reconciliation is tracked in each operation receipt. Uncertain effects block new intents and normal step completion. Coordinator bookkeeping can settle an existing receipt after Stop or expiry without restarting the task. No receipt update itself calls a provider. Treat an already prepared `ready` result's application receipt separately from its build state.

**Verified:** malformed/oversized records and illegal transitions rejected; owner/revision/claim conflicts rejected; duplicate creation/answer/receipt conflicts rejected; secret-like connection fields excluded. Tests also cover usage reservations, interrupted receipts, cancellation, deadline expiry, due wakeups, and public TypeScript declarations. The progress log records exact results. This is pure contract evidence; authenticated storage concurrency and real provider recovery remain unverified until the later tasks.

## 1B.02 — Link the notebook to the local draft

Implementation stores an optional `assistantTaskLinks` field beside the existing local checkpoint, outside the scene snapshot and Undo history. It contains the draft's `localId`, completed account entries `{ ownerId, projectId, taskId }`, and optional `pending: [{ ownerId, input }]` creation submissions. At most eight distinct accounts are retained across both lists. No field means no association. This is one current optional contract; there is no alternate schema, migration, or second storage location. Completed links contain identifiers only. Pending creation retains the exact validated bounded input until its receipt arrives; project media remains in its existing local Blob store.

The [shared task reference parser](../../../packages/pvo-assistant/tasks/reference.js) uses the same bounded IDs as 1B.01. The [editor domain rules](../../../editor/src/domain/assistant/taskProjectLink.ts) enforce draft binding, unique accounts, and the entry limit. Each account can update its current task within the same server project; silently switching that association to another server project is rejected. Account entries are retained locally when signing out so the same creator can recover their locator later. They grant no server access.

The [named link commands](../../../editor/src/state/assistant/taskProjectCommands.ts) capture account/project scope before an authenticated request and consume its validated task record afterward. They reject a wrong owner, project/account switches (including switching away and back), and a response superseded by a newer association. A pending submission stores its original request/context/examples and operation ID before POST; a matching receipt clears only that owner's pending input and stores IDs. The returned task's answers and artifacts are not copied into the checkpoint. The task adapter uses the authenticated 1B.03 routes, flushes the local project and pending submission before task creation, and flushes the new association before claiming it is durably linked. Existing save-failure status/retry handles a failed local write; it must not cause blind task recreation.

The [assistant session scope](../../../editor/src/state/assistant/sessionScope.ts) clears the visible conversation/composer when the account or local project changes. Native assistant requests also check that scope around asynchronous work, so late answers/errors cannot repopulate the new account. Anonymous ordinary editing remains available. Cloud task creation and private task reads require the server authorization boundary.

Reload and rename preserve the association; ordinary Undo leaves it unchanged. Replacing the local project identity clears it. The [atomic saved-project copy adapter](../../../editor/src/infrastructure/projectPersistence/copyProject.ts) creates a distinct local checkpoint, shares only local Blob references, and strips all authoring-task associations. It refuses to overwrite another saved project. Copying obtains a new server association when a later owned task is created; it does not copy, create, or delete a hosted service. No project-copy UI or service-sharing choice is added in this slice; callers have one defined independent-copy operation. Service attachment/lifecycle rules remain 1D/1E work.

**Verification:** Node tests cover validation, checkpoint round trips, rename/Undo, account visibility, stale replies, and copy policy. The `task-project-link` browser check exercises real IndexedDB save/reload, exact media bytes, link-only autosave, named copy, project navigation, mocked account switches/expiry, a delayed native assistant response, and actual failed-restore recovery. The progress checkpoint records final check/build/beta results. It does not claim a live server task or real third-party account integration: account/assistant HTTP responses are fixtures until the task routes exist.

## 1B.03 — Store the task and expose owned operations

Resolve the first owned server project before task creation; a fresh local draft has no server project ID yet. Scope lookup to the authenticated owner plus local draft identity, return a server-issued project ID, and verify ownership again when creating/listing tasks. An account switch must never reuse another owner's association. A local locator alone is not proof that a server project exists.

The implemented design uses one SQLite Durable Object per authenticated owner for project associations, tasks, indexes, atomic state changes and retention alarms. Reuse current account identity; do not build a second authentication system. Keep provider registration and application bindings separate from domain rules.

Proposed HTTP surface:

| Operation | Suggested route | Required behavior |
| --- | --- | --- |
| Resolve owned project | `POST /api/assistant/projects` | Authenticate and idempotently resolve/create the owner's project association for a local draft; return its server-issued ID |
| Create | `POST /api/assistant/tasks` | Authenticate, validate bounds, reserve capacity, atomically save before responding; creation key prevents duplicates |
| List owned tasks | `GET /api/assistant/tasks?project=…` | Authenticated, bounded pagination, owner/project filters enforced by server |
| Read | `GET /api/assistant/tasks/:id` | Return the owned public task view and revision |
| Answer | `POST /api/assistant/tasks/:id/answers` | Validate question/revision and deduplicate the answer operation |
| Resume | `POST /api/assistant/tasks/:id/resume` | Reconcile unresolved effects before authorizing a retry |
| Stop | `POST /api/assistant/tasks/:id/stop` | Revoke the execution generation and schedule release of owned active resources |

These routes are implemented. Read the [server contract](../../../server/assistant/tasks/README.md) for exact envelopes, status codes, capacity and retention policy. Use the repository's same-origin/CSRF protection and account-session helpers. Apply ownership checks on every operation and avoid disclosing another account's task existence or contents. Cloud building requires an owner; ordinary anonymous assistant use should retain its existing behavior.

**Verification:** two separate authenticated owners, anonymous access, cross-origin writes, missing storage, duplicate creates, oversized input, repeated answers, invalid question IDs, and true storage restart. Unavailable bindings must return an accurate unavailable result, not an in-memory success.

## 1B.04 and 1B.05 — Run work independently of the browser

**1B.05 is implemented and verified ahead of 1B.04.** Durable alarms, claims, checkpoints, bounded planning, private inference journals, cancellation and quota settlement run in the server coordinator. Read the [runner contract](../../../server/assistant/tasks/README.md#saved-planning-runner-1b05). Tests use controlled planning responses with real local workerd storage/alarms; no live generated workspace is claimed. The 1B.04/1B.06 editor integration is now verified; check the progress file for exact checks and release state.

The native assistant now has an exclusive `cloudTask:{examples}` result for hosted behavior requests. It is offered only to a supporting client with a real signed account, configured task storage and a metered planning model. The shared parser rejects owner/provider/URL/code fields, mixed operations, observations, answers or blockers. Ask mode and already prepared native edits cannot hand off. The original creator prompt and bounded private-data projection become task input; ordinary edits retain their existing atomic command path.

The creation workflow flushes the project, resolves its owned server identity, saves the exact submission with one random creation ID, and flushes it before POST. Interrupted creation replays that same body after reload. It never replaces an unfinished current task or a pending creation silently. Receipt attachment checks account/project epoch, association identity, owner and original input before removing pending content. A failed write keeps the usual persistent project-save issue; it cannot trigger a new creation identity. A remount waits for a cancelled creation attempt to settle before recovering. Independent copies remove completed and pending associations.

Server 410 is the only condition that offers **Clear expired request** for a pending submission. This explicitly removes the expired local request so a later creator request can start anew; a timeout or generic network failure never clears it. Completed references can remain as expired locators; a new explicit request resolves the same owned project and obtains a new operation ID.

Use a persisted wakeup mechanism appropriate to the chosen coordinator, such as Durable Object alarms. A long HTTP response, browser timer, or `waitUntil()` alone is not the saved runner. Every wakeup should:

1. Load the task and confirm it can run.
2. Atomically acquire a step claim with a deadline and execution generation.
3. Persist intended effects and reserve their allowed usage before starting them.
4. Execute a bounded step through explicit adapters.
5. Check the current generation before saving its result or starting another effect.
6. Save its receipt and next state/wakeup; release resources owned by that step.

Separate retryable reads from external writes whose outcome is unknown. Bound retries, model turns, tool calls, total task duration, retained artifacts, and concurrent tasks. Enforce reservations on the server and release unused reservations after cancellation. Preserve the application's existing inference budget; browser-origin assumptions must not be the authorization mechanism for a background runner.

In 1B, use a small controlled authoring step to prove the lifecycle. Arbitrary model-written backend generation belongs to 1C. Use the proven 1A adapter when the acceptance check needs a real workspace rather than claiming a timer fixture proves a live build.

**Verification:** close the browser during work, recreate the runner process, race two wakeups, expire a claim, stop during a delayed adapter call, and deliver the old result afterward. Only the current claim may commit, and no new effect may start after Stop. The saved task must still be queryable.

## 1B.06 — Show progress in the existing assistant

The saved task card lives in the existing assistant thread and has an entry button after reload even when session exchanges are empty. It shows “Working,” “Needs your answer,” “Ready,” “Stopped,” and “Failed” from saved state, bounded failure reasons, previous saved answers, suggested answers plus free text, and explicit Stop/Resume controls. The build checkpoint honestly reports unavailable until 1C; ready results offer explicit guarded application in 1B.07. Command failures use the card; project-save failures retain their existing recovery surface.

The task session reads owned progress through a disposable adapter. Disconnect polling/listeners on unmount or account change; this must not cancel the server task. A separate Stop command cancels it. An expired session should offer sign-in and preserve the ability to recover the owned task afterward.

**Verified:** actual editor + real IndexedDB/workerd/D1/SQLite recover one task after a lost creation response and page closure; a saved question can be answered, stopped, and recovered after reload. Signed-out content is hidden behind sign-in; another account cannot see the task. Desktop and two phone layouts passed, including saved-task entry with an empty session thread. Unit regressions cover immediate cancelled-remount recovery, stale reads/commands, failed pending and receipt saves, duplicate answers, expiry and account/project guards. Controlled model and HTTP bridge fixtures are explicit; no real generated service is claimed.

## 1B.07 — Save and apply a prepared result

**Verified.** The [prepared result contract](../../../packages/pvo-assistant/results/README.md) permits bounded component operations only. The owned SQLite coordinator saves immutable canonical bytes and ready state in one transaction. Its authenticated result GET survives full runtime restart and expires with task content. Only a trusted current worker can complete a result; Stop, stale claims and write failures prevent publication.

The editor uses persisted media IDs for its saved starting fingerprint, so reopening an unchanged video draft remains a match. It verifies downloaded size/digest and task ownership, then uses existing native preparation/compiler/commit checks. One complete history update and its apply-once receipt are checkpointed together. Receipts remain outside Undo/Redo and copies drop them. Changed drafts and failed preparation preserve the current project and saved result. Save failures keep the existing persistent recovery surface.

**Verified browser scenarios:** close before controlled completion; full workerd restart; reopen with restored real media and apply once; duplicate application after reload/Undo; Redo; reopen after another edit and preserve it. Shared/server tests additionally cover wrong account/project, immutable replacement, stale completion, atomic storage rollback, byte integrity and retention. This does not claim the later live workspace builder or automatic conflict reconciliation. Component service attachment still waits for 1E.

## 1B.08 and 1B.09 — Recover completed effects

Use a stable operation identity based on task, step, and attempt before provisioning. Store both intent and final receipt outside the temporary workspace. For an interrupted deployment, query its recorded provider identity; adopt the already created owned resource instead of creating another.

Distinguish “not yet attempted,” “provider outcome unknown,” “completed,” and “confirmed absent.” Only a proven absence or an adapter's documented duplicate-safe operation permits a new create. Keep resource ownership checks in trusted code. A transient provider read failure is not proof of absence.

**Verified locally and on the actual provider:** create succeeds but its response is lost; runner crashes before saving success; provider lookup is temporarily unavailable; Stop arrives during reconciliation. A resumed task finds its original resource and records it once. Prove the actual provider path using disposable resources and verify final cleanup; fixtures cover deterministic failure branches.

## 1B.10 — Acceptance matrix and beta delivery

| Scenario | Verified evidence |
| --- | --- |
| Close during an active step | `cloud-agent-tasks/browser-lifetime.mjs`, `editor/saved-tasks.mjs` and `editor/saved-results.mjs`: server finishes controlled planning/result work after page closure |
| Close while a question is pending | Runner/editor suites: question and prior answers persist; answer continues the same task |
| Restart runner | Real local workerd destruction/recreation plus live forced coordinator reset before provider receipt |
| Concurrent wakeups | Runner/provider suites: one current claim, one provider create and one result commit |
| Lost deployment reply | Live Cloudflare release recovered under its original owned identity, charged once, probed and deleted; separate local reply-loss test |
| Stop then late completion | Task/result/runner suites plus live cancellation tombstone before delayed publication; stale worker cannot complete or revive stopped work |
| Wrong account | Task route/result and editor suites deny list/read/answer/resume/Stop/result access across owners |
| Changed local project | Saved-results browser: newer edits preserved and saved result remains available |
| Account expiry/switch | Saved-task/project-link browser suites clear old private state and reject delayed replies |
| Budget or provider unavailable | Runner/provider suites: saved failures, five bounded provider retries, no hot alarm loop, retained uncertainty and deadline cleanup |
| Actual beta | `restyle-editor-shell-bf736f38b7e88ad0` served from actual Desktop `dist/`; HTTP HTML/release/SW and fresh Chromium activated worker/cache/UI passed |

Acceptance source: `6e0f78b6c490a5c782692f6a95dee76584141522`. Full checks: 1,207 Node tests, 581 syntax modules, 754 dependency modules, 237 formatting files, editor types, product/WASM build, Worker dry runs and CI. Browser inputs/model/completion and bridge are controlled fixtures; the provider recovery itself ran on Cloudflare. The Desktop Node beta serves the updated UI but does not expose Worker task APIs. General code generation belongs to 1C, and the complete live product journey remains 1F.

Run focused contract/storage/runner tests and the affected real browser journey, then the repository checks and editor type check. App changes require `npm run build` and the beta procedure in AGENTS.md, preserving pending output and open sessions. Record commands, actual results, tested code, cleanup receipts, and beta revision in the progress log.

Only after the matrix and the Roadmap 1B checkboxes are complete should the current checkpoint advance to **1C.01**, the generated service package and test agreement.
