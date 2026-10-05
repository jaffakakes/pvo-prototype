# Roadmap 1B implementation plan: the agent's saved notebook

[Task checkboxes](01-first-working-component.md#1b-save-the-task-and-its-questions) · [Current checkpoint](../restyle-cloud-agent-progress.md) · [Handoff](../restyle-cloud-agent-handoff.md)

**Plain-English result:** Restyle remembers what you asked it to build, what it has already done, and what answer it needs from you. Closing the editor does not erase the task. Returning to it resumes the same work.

This is the next implementation milestone. This document is a proposed build plan, not evidence that any of these APIs, fields, or folders already exist. Keep completion markers in Roadmap 1; record decisions and evidence in the progress log.

## First useful change

Start with **1B.01: the shared task record and its rules**. Read the current assistant contract and account/session boundary. Write a small set of pure validation and state-transition functions plus their meaningful tests. The first change should answer: “What is a valid saved task, and what changes are allowed?” It does not need a new cloud deployment or UI.

Then make one real task survive storage restart before adding orchestration or progress screens. Prove each layer through its public boundary before connecting the next.

## Suggested source ownership

Use these locations after checking the current branch. New names are proposals; create files only when implementing their responsibility.

| Responsibility | Existing code to inspect | Proposed home for new code |
| --- | --- | --- |
| Shared task input, output, validation, pure transitions | [assistant package](../../../packages/pvo-assistant/native/index.js) and [types](../../../packages/pvo-assistant/native/index.d.ts) | A focused `packages/pvo-assistant/tasks/` public entry point |
| Authentication and route guards | [account sessions](../../../server/auth/sessions.js), [reply routes](../../../server/replies/routes.js), [HTTP helpers](../../../server/http.js) | `server/assistant/tasks/routes.js`; thin entry wiring |
| Saved task and step storage | [assistant budget object](../../../server/assistant/budget.js), existing repository adapters | Focused storage/coordinator modules beside the task routes |
| Background authoring loop | [current model workflow](../../../server/assistant/native/service.js), [budget reservation](../../../server/assistant/quota.js) | Task runner and effect adapters, separate from HTTP and domain rules |
| Local project association | [local persistence](../../../editor/src/infrastructure/projectPersistence/index.ts), [project sessions](../../../editor/src/state/project/sessionActions.ts) | A focused project/task link through the existing persistence commands |
| Task HTTP transport | [native transport](../../../editor/src/infrastructure/assistant/nativeTransport.ts) | A separate task transport adapter |
| Task presentation | [assistant session](../../../editor/src/features/assistant/useAssistantSession.ts), [thread store](../../../editor/src/state/assistant/threadStore.ts) | Focused task views/hooks under the assistant feature |
| Safe component application | [native commands](../../../editor/src/state/assistant/nativeCommands.ts), [request workflow](../../../editor/src/features/assistant/assistantRequestWorkflow.ts) | Reuse existing fingerprint/history guards through named commands |

Shared task rules must not import React, Zustand, editor stores, Worker bindings, or network APIs. Server effects must not import editor internals. Do not turn the current assistant routes or thread store into the entire task system.

## 1B.01 — Define the record and legal changes

Agree one current shape and export its runtime validator and types from the same shared owner. Include the following responsibilities; final field names should follow nearby conventions.

| Information | Purpose and rule |
| --- | --- |
| Task identity | Server-issued stable ID; repeated creation with the same client operation key returns the same task |
| Owner | Derived from the authenticated server session; callers cannot assign another owner |
| Project identity | Links to an owned project association; a local numeric project ID alone is not globally unique |
| Request and examples | Original goal and expected behavior cases saved before code generation |
| Bounded context | Component/source context and project fingerprint required for the task; no whole-video upload by default |
| State and step | Saved state plus the next resumable step; state is distinct from the text shown in the UI |
| Questions and answers | Stable question IDs, answer revisions, answered/unanswered state; private account keys are not answers |
| Step receipts | Operation ID, input digest, outcome, artifact/provider references, and whether reconciliation is needed |
| Prepared result | Validated proposed component changes and the project fingerprint they were prepared against |
| Revision and execution ownership | Monotonic revision and a claimed execution generation so an old worker cannot commit after Stop or takeover |
| Bounds and timestamps | Created/updated times, retry count, deadline, next wakeup, and usage reservations |
| Errors | Sanitized operation context and a useful recovery classification; secrets and private payloads stay out |

Define byte/count limits for every variable-length field and collection, plus retained task/result lifetime. Do not add unbounded conversation or tool-output arrays. Choose values from the existing context/model limits and record the decision before implementing storage. The 1A fixture's 20 calls and 60 seconds are diagnostic limits, not automatically the product's final policy.

Suggested initial states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `queued` | Saved, waiting for its next run | `running`, `stopped` |
| `running` | A current execution claim owns a step | `queued`, `waiting_for_answer`, `ready`, `failed`, `stopped` |
| `waiting_for_answer` | A saved question needs the creator | `queued` after a valid answer, or `stopped` |
| `ready` | A validated result is saved for the editor | Terminal for this build attempt |
| `failed` | Work stopped with a recorded reason | `queued` only after explicit resume of a recoverable failure |
| `stopped` | Creator cancelled further work | Terminal; continuing creates a new linked attempt if needed |

Keep reconciliation pending in a specific step receipt. Never move an uncertain side effect straight back to an unrecorded new attempt. Treat an already prepared `ready` result's application receipt separately from its build state.

**Verification:** malformed/oversized records rejected; invalid transitions rejected; stale revisions cannot update a record; duplicate operation IDs with changed payloads rejected; secret-like connection fields are excluded from the task contract. Record the final contract decisions in the evidence log.

## 1B.02 — Link the notebook to the local draft

The current editor thread uses `localId` and stores its visible conversation in memory. Keep an owned server project association and task reference through the existing local checkpoint/persistence path. Persist the minimal link without copying media to the server.

Define these behaviors explicitly: reload restores the link; account switch clears visible private task data; a different local project cannot inherit an old task; project duplication starts a distinct association by default unless an explicit sharing operation is chosen. A project rename should preserve identity.

**Verification:** save/reload, duplicate, switch project, switch account, and local draft recovery. Check existing editor persistence behavior is preserved.

## 1B.03 — Store the task and expose owned operations

Choose and document one storage/coordinator design. A SQLite Durable Object can own task state and atomic step claims, with a deliberate owned task index for listing/recovery. Reuse current account identity; do not build a second authentication system. Keep provider registration and application bindings separate from domain rules.

Proposed HTTP surface:

| Operation | Suggested route | Required behavior |
| --- | --- | --- |
| Create | `POST /api/assistant/tasks` | Authenticate, validate bounds, reserve capacity, atomically save before responding; creation key prevents duplicates |
| List owned tasks | `GET /api/assistant/tasks?project=…` | Authenticated, bounded pagination, owner/project filters enforced by server |
| Read | `GET /api/assistant/tasks/:id` | Return the owned public task view and revision |
| Answer | `POST /api/assistant/tasks/:id/answers` | Validate question/revision and deduplicate the answer operation |
| Resume | `POST /api/assistant/tasks/:id/resume` | Reconcile unresolved effects before authorizing a retry |
| Stop | `POST /api/assistant/tasks/:id/stop` | Revoke the execution generation and schedule release of owned active resources |

These names are proposals, not existing routes. Use the repository's same-origin/CSRF protection and account-session helpers. Apply ownership checks on every operation and avoid disclosing another account's task existence or contents. Cloud building requires an owner; ordinary anonymous assistant use should retain its existing behavior.

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
