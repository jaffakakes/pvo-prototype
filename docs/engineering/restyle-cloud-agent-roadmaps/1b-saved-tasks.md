# Roadmap 1B implementation plan: the agent's saved notebook

[Task checkboxes](01-first-working-component.md#1b-save-the-task-and-its-questions) · [Current checkpoint](../restyle-cloud-agent-progress.md) · [Handoff](../restyle-cloud-agent-handoff.md)

**Plain-English result:** Restyle remembers what you asked it to build, what it has already done, and what answer it needs from you. Closing the editor does not erase the task. Returning to it resumes the same work.

This milestone is in progress. **1B.01–1B.03 are implemented:** the [shared task contract](../../../packages/pvo-assistant/tasks/README.md) defines records, limits, and pure transitions; local draft checkpoints retain scoped task locators. Owned server storage and routes are verified; the runner and task UI remain planned. Keep completion markers in Roadmap 1; record decisions and evidence in the progress log.

## First useful change

Completed **1B.01: the shared task record and its rules** answers: “What is a valid saved task, and what changes are allowed?” Its pure functions and tests need no cloud deployment or UI. The record carries trusted owner metadata, a server project identity, and the original project fingerprint.

The local project association in **1B.02** is also complete. **1B.03** now resolves owned server projects and preserves real tasks across storage restart. Continue with **1B.04/1B.05**, the saved runner and backend intent routing. Prove each layer through its public boundary before connecting the next.

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

Implementation stores an optional `assistantTaskLinks` field beside the existing local checkpoint, outside the scene snapshot and Undo history. It contains the draft's `localId` and up to eight account entries: `{ ownerId, projectId, taskId }`. No field means no association. This is one current optional contract; there is no alternate schema, migration, or second storage location. Only identifiers are added; project media remains in its existing local Blob store.

The [shared task reference parser](../../../packages/pvo-assistant/tasks/reference.js) uses the same bounded IDs as 1B.01. The [editor domain rules](../../../editor/src/domain/assistant/taskProjectLink.ts) enforce draft binding, unique accounts, and the entry limit. Each account can update its current task within the same server project; silently switching that association to another server project is rejected. Account entries are retained locally when signing out so the same creator can recover their locator later. They grant no server access.

The [named link commands](../../../editor/src/state/assistant/taskProjectCommands.ts) capture account/project scope before a future authenticated request and consume its validated task record afterward. They reject a wrong owner, project/account switches (including switching away and back), and a response superseded by a newer association. They save IDs only, not the returned task's request, answers, source, or artifacts. The future task adapter must use the authenticated 1B.03 routes, flush the local project before task creation, and flush the new association before claiming it is durably linked. Existing save-failure status/retry handles a failed local write; it must not cause blind task recreation.

The [assistant session scope](../../../editor/src/state/assistant/sessionScope.ts) clears the visible conversation/composer when the account or local project changes. Native assistant requests also check that scope around asynchronous work, so late answers/errors cannot repopulate the new account. Anonymous ordinary editing remains available. Cloud task creation and private task reads still require the future server authorization boundary.

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

Route only backend-building requests into the new saved-task path. Keep ordinary editing on the existing atomic editor command path. Availability should depend on actual server capabilities.

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

Show “Working,” “Needs your answer,” “Ready,” “Stopped,” and “Failed,” using server state. Render saved questions, answers, and concise reasons. Use the existing notification rules and persistent unresolved status.

Fetch or subscribe to owned progress through a disposable adapter. Disconnect polling/listeners on unmount or account change; this must not cancel the server task. A separate Stop command cancels it. An expired session should offer sign-in and preserve the ability to recover the owned task afterward.

**Verification:** reload while a question is pending; return to the same task and answer; close while running and reopen; account-switch late responses cannot repopulate private data; failed saves remain visible.

## 1B.07 — Keep the result safe until it can be applied

Save prepared changes on the server with their owner, task, project identity, and starting fingerprint. On editor return, run existing command validation and fingerprint checks before applying the entire batch as one history operation.

If the draft has changed, keep the result available and explain that it needs reconciliation. Do not overwrite the creator's newer edits. Save a result/application identity so replaying a response cannot apply it twice. Component service attachment still waits for the validated receipt contract in 1E.

**Verification:** close before completion; reopen unchanged and apply once; reopen after another edit and retain that edit; duplicate completion responses; wrong-project result; Undo through the existing history boundary.

## 1B.08 and 1B.09 — Recover completed effects

Use a stable operation identity based on task, step, and attempt before provisioning. Store both intent and final receipt outside the temporary workspace. For an interrupted deployment, query its recorded provider identity; adopt the already created owned resource instead of creating another.

Distinguish “not yet attempted,” “provider outcome unknown,” “completed,” and “confirmed absent.” Only a proven absence or an adapter's documented duplicate-safe operation permits a new create. Keep resource ownership checks in trusted code. A transient provider read failure is not proof of absence.

**Verification:** create succeeds but its response is lost; runner crashes before saving success; provider lookup is temporarily unavailable; Stop arrives during reconciliation. A resumed task finds its original resource and records it once. Prove the actual provider path using disposable resources and verify final cleanup; fixtures cover deterministic failure branches.

## 1B.10 — Acceptance matrix and beta delivery

| Scenario | Result required before marking 1B complete |
| --- | --- |
| Close during an active step | Server continues to a saved result or saved question |
| Close while a question is pending | Same question and prior answers return; answering continues the same task |
| Restart runner | Completed steps remain completed; pending work resumes under one current claim |
| Concurrent wakeups | One owner executes the step; no duplicate create or duplicate result |
| Lost deployment reply | Existing owned resource is found, recorded, and cleaned up correctly |
| Stop then late completion | Stale worker cannot commit a ready result or start the next effect |
| Wrong account | Read, answer, list, resume, stop, and result application are denied |
| Changed local project | Newer local edits are preserved; saved prepared result remains recoverable |
| Account expiry/switch | Private task data is cleared from the old session and cannot reappear via a late response |
| Budget or provider unavailable | Clear saved failure/wait reason; no hidden unbounded retries or fake completion |
| Actual beta | New build served from the active beta output directory with the expected service-worker revision |

Run focused contract/storage/runner tests and the affected real browser journey, then the repository checks and editor type check. App changes require `npm run build` and the beta procedure in AGENTS.md, preserving pending output and open sessions. Record commands, actual results, tested code, cleanup receipts, and beta revision in the progress log.

Only after the matrix and the Roadmap 1B checkboxes are complete should the current checkpoint advance to **1C.01**, the generated service package and test agreement.
