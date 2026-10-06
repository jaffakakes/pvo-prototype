# Saved assistant tasks

The authenticated HTTP adapter uses the existing account cookie/session database. It selects one `AssistantTasks` SQLite Durable Object by `owner:<server-session-user-id>`. The object's first owner is also stored and checked. Browser-supplied project/task IDs are locators only; no HTTP route accepts an owner, execution claim, coordinator command, provider receipt, or clock.

`input.js` validates the HTTP inputs. `repository.js` owns synchronous SQL access and calls the [shared task rules](../../../packages/pvo-assistant/tasks/README.md). `coordinator.js` owns clock/IDs/hashing, atomic transactions and persisted wakeups. `runner.js` bounds one planning invocation; `attempts.js` journals dispatch and usage settlement; `planner.js` restricts model output to questions or the next build checkpoint. `routes.js` owns account, origin, body limits and response handling. The application entry point only dispatches routes.

## HTTP contract

All responses are private (`Cache-Control: no-store`), with no cross-origin read permission. Writes require the configured exact Origin and existing same-origin fetch checks. Publishing need not be enabled. Missing or failed task storage returns 503, never a successful temporary task.

| Method and path | Input | Response |
| --- | --- | --- |
| `POST /api/assistant/projects` | `{localId}`: saved local draft ID | `{project:{id}}`, server-issued ID; same owner/draft resolves identically |
| `POST /api/assistant/tasks` | Valid shared `TaskInput` with resolved project ID | `{task,created}`; 201 for new, 200 for exact replay |
| `GET /api/assistant/tasks?project=ID&limit=20&before=ID` | Owned project required; optional limit 1–20 and opaque cursor | `{tasks,next}`; descending opaque ID, `next:null` at end |
| `GET /api/assistant/tasks/:id` | None | `{task}` |
| `GET /api/assistant/tasks/:id/result` | None; owned ready task required | Canonical prepared-result JSON bytes, matching the saved artifact size and SHA-256 |
| `POST /api/assistant/tasks/:id/answers` | `{expectedRevision,questionId,questionRevision:0,operationId,value}` | `{task}` |
| `POST /api/assistant/tasks/:id/resume` | `{expectedRevision}` | `{task}` |
| `POST /api/assistant/tasks/:id/stop` | `{expectedRevision}` | `{task}` |

Lists are bounded traversals, not a frozen snapshot during concurrent creation. Unknown extra query/body fields are rejected. Task input is bounded by the shared 128 KiB maximum. Question values support free text, including with suggested choices. Another owner's task/project returns the same 404 as an absent one. Anonymous access returns 401. Incorrect/stale state returns 409; refetch the task before deciding whether to retry. An exact repeated answer uses the **current task revision** and original answer identity/value, returning unchanged state. Stop is terminal for that task attempt.

The HTTP response carries the validated shared record. It contains the creator's request, bounded component source, answers and internal locators, so it must remain account-private. This API never places credentials in those records. Callers must use future private connection flows for credentials; the schema does not detect a secret pasted into ordinary prose.

## Atomic storage and limits

Project resolution, creation identity, capacity checks and insertion happen in the same storage transaction. Canonical JSON key ordering produces a SHA-256 creation digest; replay also compares the actual validated input through the shared contract. Mutations load current state, validate the expected revision and use a conditional revision update. SQL changes and the next retention alarm commit together. There are no provider effects inside a storage transaction. The repository also archives receipts removed from the current notebook in that same transaction. `archivedOperations` must exactly match those stored removals. Unknown operations cannot be archived; archived IDs cannot become new attempts, and exact replays still pass the ordinary owner/revision/claim guards. Archived pages are bounded to eight owned receipts. Active goals keep this history; terminal retention removes it only when task deletion is safe.

Per owner: 64 project associations, 32 retained full task records, two unfinished tasks, eight creations per UTC day, and 4,096 lifetime compact creation identities. Resume checks the unfinished-task capacity too. Replays do not consume new capacity. The runner must separately reserve inference/tool capacity before effects; these storage bounds do not authorize model usage.

Unfinished goals have `finishedAt: null` and `expiresAt: null`; age does not end or erase them. Ready/Stop sets the finish time and starts seven-day private-content retention. After that, settled task content is removed. Compact creation identity rows (task ID, creation operation ID, project ID and creation time) remain within the 4,096 limit. Replaying an expired creation returns 410 instead of silently starting new work. Project associations remain bounded and stable; retaining them prevents a reopened local draft from being silently assigned a different server project.

An unresolved operation or reserved usage prevents content deletion until trusted reconciliation finishes. Expired content is hidden by the public API even while its private bookkeeping is retained. There is no browser route to clear an uncertain receipt. The inference journal now settles interrupted planning usage through trusted `reconcile_usage`; later deployment/provider adapters must reconcile their own external outcomes through a trusted path; retention must never destroy the only evidence of a possibly completed action.

Storage behavior follows Cloudflare's [SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction) and [persisted alarms](https://developers.cloudflare.com/durable-objects/api/alarms/). `wrangler.jsonc` registers the new SQLite class; that registration is provider setup, not support for an alternate project/task format.

## Verification and current scope

`node --test tests/assistant-task-server/*.test.mjs` uses the actual application HTTP router, signed account cookies, local D1, and workerd SQLite Durable Objects. It destroys and recreates the whole Miniflare runtime against a disk persistence directory, retaining projects/tasks/questions/answers/capacity. It covers concurrent creates, answer/Stop revision races, cross-account access, origin failures, unavailable bindings, bounded inputs, worker deadlines, long goal lifetimes, private-content retention and idempotency after expiry. The test subclass has private controls to supply time and simulate a trusted step; none are exported by the product Worker.

1B.03 stores and manages tasks. **1B.05 now executes saved planning independently of the browser.** Backend intent routing and the editor task screen remain 1B.04/1B.06. The Node static beta server does not yet expose the Worker task API. Reaching the `build` checkpoint currently records `provider_unavailable`; arbitrary workspace construction is 1C and cannot be reported as a completed build here.

## Saved planning runner (1B.05)

A durable alarm acquires a 60-second execution claim and processes at most two planning steps per invocation. Before invoking the provider, it saves a SHA-256 input digest, a stable inference identity, and one task model-turn reservation. It reserves from the existing daily `AssistantBudget` with an account hash and an idempotent operation hash. Foreground and saved work share the 60-request service allowance; saved work has a 20-per-owner daily and 12-per-minute allowance, while foreground requests retain their existing address-based client allowance. Model turns are accounted for, including outstanding reservations, without a fixed per-task turn cutoff. The existing shared daily/minute allowances still apply. Their trusted denial now supplies a reason and exact reset time; the runner settles the unused attempt and saves a `waiting` state. A due alarm resumes the same cursor. Provider 429 responses wait for a bounded retry; dispatched inference is charged conservatively. Foreground boolean reservation behavior is preserved. Saved-goal permission is checked separately through the account grant below. Workspace budget denials also save a trusted capacity/allowance reason and retry time, preserving immutable denied-start receipts and saved source. Only a new denied start pauses work; reading an old receipt does not.

Each inference has a 45-second outer deadline, even if the provider ignores cancellation. The last dispatch check rereads the persisted execution generation synchronously immediately before the model call. Stop commits first, invalidates the generation, and aborts the active local signal. Late replies cannot ask a question, mark ready, advance a step or start another inference. A cancelled step can settle its already-recorded usage/receipt without restarting the task.

Planning uses the existing configured model adapter. Its only accepted outputs are a bounded follow-up question or a request to advance to `build`. It cannot execute model tool calls, deploy, send messages, provide a service URL, or invent a ready receipt. Questions get server-assigned IDs. The model sees the original bounded input and saved answers; platform credentials never enter its context.

The journal records whether invocation was dispatched. Proven unused capacity is released. An interrupted dispatched inference is charged conservatively and its unrecorded answer is discarded; expired claims can be recovered without a goal-wide retry count. This is safe only because this adapter performs read-only planning inference. An unknown deployment, booking or message must use the separate provider reconciliation required by 1B.08/1B.09; it must never adopt this inference recovery rule.

Account settlement is idempotent, including cancellation arriving before a delayed reservation. A budget object retains at most 4,096 compact reservation identities per day. Each alarm performs at most four settlement calls, each bounded to five seconds. Failed settlements retry twice with backoff; after the third failure they wait for that UTC budget's expiry, keeping capacity conservatively occupied. Task journals remain until usage bookkeeping and task-content retention both permit removal.

The browser lifetime check is `node scripts/checks/cloud-agent-tasks/browser-lifetime.mjs`. It closes Chromium during a controlled server step, then opens another browser context and reads the same saved question from real local workerd/D1/SQLite. It is a server-lifetime harness; the actual editor journey is `npm run check:browser -- editor saved-tasks`. Neither test claims a live model/provider build. The Node runner suite separately destroys workerd during active inference, recreates it from disk, and proves that only the recovered claim's answer is accepted.

## Editor handoff and progress

The native assistant route offers `cloudTask` only when this task storage, the metered planner, a signed current account, and the supporting client are present. The browser header is a contract opt-in, not authorization. Ordinary anonymous native editing remains available. The model supplies bounded behavior examples; trusted editor/server adapters create all identities and retain the original creator request.

The editor persists the exact creation input before sending it and replays that input after an uncertain response. Progress polling is disposable and never keeps the server running; Stop is a distinct authenticated mutation. Answers refresh the task before submission, reuse an operation identity for a repeated answer, and respect already committed answers from other tabs. Live service generation remains a later milestone. Prepared component results use the owned storage and guarded application path below.


## Prepared results and application (1B.07)

`completePreparedResult` is a private coordinator capability for the trusted runner. It derives owner/project/task/base identity from the saved task, allows only the [prepared component contract](../../../packages/pvo-assistant/results/README.md), and hashes canonical UTF-8 JSON. After hashing, it rechecks the current execution revision and unexpired worker claim. One SQLite transaction writes both ready state and immutable artifact bytes. A failed artifact write rolls the task transition back. Exact completed replays return the existing result; changed contents conflict. No browser or model tool can complete a task directly.

One artifact per retained task is bounded to 1 MiB. SQLite's [2 MB string/BLOB/row limit](https://developers.cloudflare.com/durable-objects/platform/limits/) accommodates this payload. Result contents are deleted with settled task content. Owned GET returns 409 before ready, 404 for absent/expired/other-owner tasks, and 503 if an expected artifact is unavailable. It uses the same signed account session as task reads.

The editor hashes its starting project using persisted media asset IDs after a successful local save; browser Blob URLs change on reload and are not durable identity. Applying downloads bounded bytes, verifies their digest and ownership, compares the current saved project fingerprint, and runs every proposed change through native preparation/compiler checks. Changed drafts retain both their edits and the server result. Reconciliation of those differences is not automatic in this slice.

One store/history update contains the complete validated project change and an application receipt. IndexedDB checkpoints persist both together. Receipts contain IDs and artifact metadata only, stay outside Undo/Redo, survive new task links, and are stripped from independent copies. The bounded 64-receipt history rejects another application at capacity instead of evicting replay protection. A failed final save retains in-memory replay protection and uses the existing persistent save-error surface; retry cannot insert another component.

`npm run check:browser -- editor saved-results` closes the actual editor before controlled completion, restarts local workerd, reopens real IndexedDB media, applies through real compilation, verifies reload/Undo/Redo/duplicate protection and keeps a newer draft edit. Native planning output and trusted completion are fixtures: the product builder still awaits 1C. Service attachment still awaits its later validated receipt contract.

## Inactive service effects and recovery

`providerOperations.js` journals a stable owned identity, frozen source digest, intent and usage reservation before dispatch. `providerRunner.js` performs bounded provider calls outside SQL transactions. `serviceProvider.js` selects private bindings by the recorded identity and validates/disposes Cloudflare RPC observations. `server/cloud-services/` owns immutable inactive releases and isolated private probes. The [release contract](../../../packages/pvo-assistant/releases/README.md) is shared through its public entry point.

A successful receipt is reused after a new claim or runtime restart. A lost reply stays unknown until provider lookup succeeds. Missing lookup leads to cancellation of that identity; only the returned durable tombstone establishes absence and permits a new attempt. Reconciliation never blindly repeats publication. A failed read is never interpreted as absence. Stop/deadline preserve completed receipts, revoke active work, and arrange owned-source cleanup. Source retained in the coordinator is cleared after settlement.

Each maintenance pass handles at most two operations, with five failed-lookup/cleanup attempts and exponential waits of 1, 2, 4 and 8 minutes. Exhaustion leaves private bookkeeping and a saved unresolved operation; it does not claim completion, delete uncertain records or continuously wake the alarm. Ordinary Resume remains blocked while an operation is unsettled. A later task deadline gives cleanup one separate bounded attempt series. If cleanup still cannot be verified, the retained record requires operator reconciliation; no public administrative retry route exists in this slice. The release's independent expiry prevents abandoned source from remaining executable.

Expired tasks are hidden from owner reads even when private cleanup bookkeeping is retained. A provider journal holding a cleanup obligation prevents content pruning until deletion is verified. This adapter is private and is not yet offered to the model: Roadmap 1C supplies the builder and Roadmap 1D supplies activation, durable business records and public invocation.

See the [disposable real-provider acceptance plan](../../../docs/engineering/restyle-cloud-provider-recovery-proof.md). Test controls, crashes and arbitrary clock changes exist only in fixtures/diagnostics.


## Answer archive and model evidence selection

`questionHistory.js` archives answered questions atomically with the current task revision. `archivedQuestions` and the recent question count allocate the next host question ID without a lifetime count cap. Exact old answer replay uses the same domain guards. Archived answer IDs cannot become new answers or effects; archived effect IDs cannot become answers. Pending questions remain current.

`evidenceInput.js` owns the closed model selection and its schema. `evidence.js` reads one indexed, task-scoped history row and projects at most 4,096 UTF-8 bytes per fragment. It supports immutable original input, frozen agreement, archived/current answers, settled operation history, research results, workspace receipts and independent review reports; it excludes provider credentials and full package bundles. The next offset counts Unicode code points. The selection includes bounded model-written working notes; these are context, never trusted validation or permission. A selection commits only with the accepted current inference and is deleted when safe terminal cleanup removes task content. `authoringResponse.js` coordinates the shared selection path for plan/build/attach without changing the build cursor, agreement or current source.


`promptContext.js` owns the pure, shared finite prompt projection for planning, building and attachment. When valid accumulated context exceeds the message bound, it marks retrievable omissions instead of mutating the saved task or returning a goal-ending size failure. Question checkpoints also compact by total serialized record bytes, retaining the pending/just-answered question. Routine journal recovery uses indexed outstanding rows, exact IDs, SQL wakeup aggregation and bounded provider/budget selection; historical `entries()` methods are fixture inspection only.

## Account permission for cloud authoring

`ASSISTANT_TASK_SPENDING` is trusted Worker configuration, separate from foreground assistant requests and model context. The checked-in value is `[]`: no account is authorized for new cloud authoring effects until an operator records approval. It is a JSON array of exact `{ownerId, expiresAt, capabilities}` records, one per account. `expiresAt` is an absolute UTC time in milliseconds; capabilities may contain `model`, `workspace`, and/or `hosting`. For example, an operator can enable only model planning for an account, then approve workspace/hosting when that is appropriate. Never derive these records from generated text, a free-text answer, a request body, or a client-supplied account identity.

`spending.js` validates the whole configuration and checks the owned task before admitting each bounded work period. Missing, invalid, wrong-account, expired or insufficient grants save `waiting / spending_permission`, with no inference, new workspace action or publication dispatched. An existing unknown effect is reconciled first. Cleanup and previously activated services retain their own lifecycle and do not require a fresh authoring grant. An already admitted work period remains bounded by its execution claim; later work periods must recheck permission.

After the operator applies approved account configuration, the creator selects **Resume**. This rechecks permission/capacity on the same task and retains its original input, answers, frozen agreement and exact tool cursor. Resume itself never grants or resets an allowance, and a later grant cannot restart a stopped task. The panel tells the creator to ask their Restyle administrator when permission is missing.

This is operator-managed permission over the existing bounded service allowance, **not a dollar balance, metered billing system, credit purchase UI or new paid-test authorization**. The existing shared model minute/daily limits and global workspace concurrency/daily limits continue to reserve and settle actual work. Foreground limits are unchanged. Do not enable real account grants without the applicable spending authorization and deployment approval. Runtime service usage and external account permissions remain separate boundaries.


## Saved authoring repairs

`repairFeedback.js` carries diagnostics explicitly captured at local authoring validation boundaries; provider/RPC exception text is not copied. `repairs.js` owns a separate private journal of rejected proposals and the current repair cursor. Each entry retains at most 128 KiB of proposal text and 2 KiB of diagnostic text, with explicit truncation. Inference receives the complete saved proposal when it fits the existing total prompt byte bound, presented as the rejected assistant attempt followed by local validation feedback. Only an oversized context projects a marked Unicode-safe preview of at most 4 KiB; the `repairs` history collection still retrieves exact saved entries through the ordinary task-owned bounded reader. Diagnostics, rejected source and model notes are untrusted context, never completion evidence or permission.

Malformed planner/builder/attachment decisions and failed component compilation record a failed inference receipt, settle its metered usage and queue the same step with feedback. Those changes and the repair row commit together. Three consecutive failures of the same check with the same diagnostic, identical complete rejected proposal and no new creator answer request help instead of spinning on that failure. A new answer allows continued repair; this is not a total limit on attempts. Merely reading history does not clear the signal. An accepted non-history decision clears current repair feedback, preserving journal history. Stop and stale claims cannot save late repairs, questions or prepared results. Safe terminal retention cleanup removes the private journal.

Authoring validation and the separate execution-progress cursors detect conservative repeated-evidence loops. Ready still requires the actual independently checked package, current owned hosting evidence and successful component compilation; a repair counter or model assertion cannot complete a goal.


An expired inactive host does not end an unfinished goal. After the original publication is settled and a real provider tombstone confirms deletion, `attachments/recovery.js` returns the same task to its trusted host step. The new claim rechecks hosting permission. `providerRunner.js` creates a generation-scoped attempt and a new logical service identity when the original service was deleted; the independently verified package/report is unchanged. Component verification rehashes the exact recorded service identity. Existing live or uncertain publications are reused/reconciled instead. Dispatch requires the journal row's exact task, generation and claim, an unexpired intent and its saved publication bytes. Old receipts and expiry times are never rewritten, and deleted services are never resurrected.


## Execution progress

`progressEvidence.js` projects semantic evidence from completed builder batches and independent reviews. Source digests, returned content/results, requests and read positions participate. Request/receipt identities, source revision counters, session deadlines and research retrieval timestamps do not. The history comparison also excludes model-written notes. Different evidence or a new creator answer permits continued work even when a check remains unsuccessful; there is no total round limit.

`progress.js` retains at most three current task-owned cursors: tools, reviews and history. Each records the last semantic signature, accepted round, answer count and consecutive identical observations. Replaying the same committed round does not increment it. Full evidence stays in the existing receipt/report journals. Three consecutive identical observations produce a saved help question before the next inference; an answer allows a new approach. These conservative comparisons do not claim to recognize every possible unproductive cycle.

Progress commits with accepted builder feedback, report/checkpoint or history selection. A failed progress write is resumable and does not repeat an already journaled tool. Questions use the current claim and ordinary saved-answer boundary; Stop fences late work. Safe terminal-content cleanup prunes the cursors. This metadata cannot grant permission, approve a release, replace a report or mark a task Ready.
