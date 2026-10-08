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
| `GET /api/assistant/tasks/:id/diagnostics` | None; current owned task required | `{reference,stepId,repair}`; bounded last rejected proposal/check, or `repair:null`; read-only |
| `GET /api/assistant/tasks/:id/result` | None; owned ready task required | Canonical prepared-result JSON bytes, matching the saved artifact size and SHA-256 |
| `POST /api/assistant/tasks/:id/answers` | `{expectedRevision,questionId,questionRevision:0,operationId,value}` | `{task}` |
| `POST /api/assistant/tasks/:id/resume` | `{expectedRevision}` | `{task}` |
| `POST /api/assistant/tasks/:id/stop` | `{expectedRevision}` | `{task}` |

When a repeated validation failure asks for repair help, the editor reads this private diagnostic inside **Build check details**. The ordinary authenticated owner boundary applies, another owner receives 404 and anonymous access receives 401. The response binds the owner/project/task reference; the client validates it, hides stale account/project results and aborts replaced reads. Generated text is rendered as text, never HTML or commands. Reading diagnostics does not claim/resume the task or invoke a provider; proposals remain untrusted and cannot grant publication or report success. The existing repair retention and UTF-8 bounds apply.

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

`ASSISTANT_DAILY_CAPACITY` is a separate optional, trusted operator secret: exact `{global, client, expiresAt}` JSON with positive safe-integer daily capacities up to 4096, client no greater than global, and an absolute future UTC millisecond expiry. Missing, malformed or expired policies use the existing 60 global / 20 client defaults. Counts are retained across a policy change, restart or expiry; the twelve-per-minute gate, reservation/refund bounds, account spending grants and all execution controls remain unchanged. This changes daily admission only, never task completion or access permissions. The full AI beta acceptance temporarily uses it under recorded authorization and restores the default after cleanup. Never accept this policy from a request, task answer or model output.

`ASSISTANT_TASK_SPENDING` is trusted Worker configuration, separate from foreground assistant requests and model context. The default policy is `[]`: no account is authorized for new cloud authoring effects until an operator records approval. The [ongoing beta deployment](../../../docs/engineering/restyle-beta-backend.md) supplies this policy through a private Worker secret so real account identifiers and grants stay outside Git. It is a JSON array of exact `{ownerId, expiresAt, capabilities}` records, one per account. `expiresAt` is an absolute UTC time in milliseconds; capabilities may contain `model`, `workspace`, and/or `hosting`. For example, an operator can enable only model planning for an account, then approve workspace/hosting when that is appropriate. Never derive these records from generated text, a free-text answer, a request body, or a client-supplied account identity.

`spending.js` validates the whole configuration and checks the owned task before admitting each bounded work period. Missing, invalid, wrong-account, expired or insufficient grants save `waiting / spending_permission`, with no inference, new workspace action or publication dispatched. An existing unknown effect is reconciled first. Cleanup and previously activated services retain their own lifecycle and do not require a fresh authoring grant. An already admitted work period remains bounded by its execution claim; later work periods must recheck permission.

After the operator applies approved account configuration, the creator selects **Resume**. This rechecks permission/capacity on the same task and retains its original input, answers, frozen agreement and exact tool cursor. Resume itself never grants or resets an allowance, and a later grant cannot restart a stopped task. The panel tells the creator to ask their Restyle administrator when permission is missing.

This is operator-managed permission over the existing bounded service allowance, **not a dollar balance, metered billing system, credit purchase UI or new paid-test authorization**. The existing shared model minute/daily limits and global workspace concurrency/daily limits continue to reserve and settle actual work. Foreground limits are unchanged. Do not enable real account grants without the applicable spending authorization and deployment approval. Runtime service usage and external account permissions remain separate boundaries.


## Saved authoring repairs

`repairFeedback.js` carries diagnostics explicitly captured at local authoring validation boundaries; provider/RPC exception text is not copied. `repairs.js` owns a separate private journal of rejected proposals and the current repair cursor. Each entry retains at most 128 KiB of proposal text and 2 KiB of diagnostic text, with explicit truncation. Inference receives the complete saved proposal when it fits the existing total prompt byte bound, presented as the rejected assistant attempt followed by local validation feedback. Only an oversized context projects a marked Unicode-safe preview of at most 4 KiB; the `repairs` history collection still retrieves exact saved entries through the ordinary task-owned bounded reader. Diagnostics, rejected source and model notes are untrusted context, never completion evidence or permission.

Malformed planner/builder/attachment decisions and failed component compilation record a failed inference receipt, settle its metered usage and queue the same step with feedback. Those changes and the repair row commit together. Three consecutive failures of the same check with the same diagnostic, identical complete rejected proposal and no new creator answer request help instead of spinning on that failure. A new answer allows continued repair; this is not a total limit on attempts. Merely reading history does not clear the signal. An accepted non-history decision clears current repair feedback, preserving journal history. Stop and stale claims cannot save late repairs, questions or prepared results. Safe terminal retention cleanup removes the private journal.

Authoring validation and the separate execution-progress cursors detect conservative repeated-evidence loops. Ready still requires the actual independently checked package, current owned hosting evidence and successful component compilation; a repair counter or model assertion cannot complete a goal.


An expired inactive host does not end an unfinished goal. After the original publication is settled and a real provider tombstone confirms deletion, `attachments/recovery.js` returns the same task to its trusted host step. The new claim rechecks hosting permission. `providerRunner.js` creates a generation-scoped attempt and a new logical service identity when the original service was deleted; the independently verified package/report is unchanged. Component verification rehashes the exact recorded service identity. Existing live or uncertain publications are reused/reconciled instead. Dispatch requires the journal row's exact task, generation and claim, an unexpired intent and its saved publication bytes. Old receipts and expiry times are never rewritten, and deleted services are never resurrected.


## Execution progress

`progressEvidence.js` projects semantic evidence from completed builder batches and independent reviews. Source digests, returned content/results, requests and read positions participate. Request/receipt identities, source revision counters, session deadlines and research retrieval timestamps do not. The history comparison also excludes model-written notes. Structured `web_evidence` assessments use only the outcome and source URL/truncation for this comparison; changing interpretation text, receipt IDs or checked time is not new external evidence. Actual `web_read` results still compare their returned content. Different evidence or a new creator answer permits continued work even when a check remains unsuccessful; there is no total round limit.

`progress.js` retains at most three current task-owned cursors: tools, reviews and history. Each records the last semantic signature, accepted round, answer count and consecutive identical observations. Replaying the same committed round does not increment it. Full evidence stays in the existing receipt/report journals. Three consecutive identical observations produce a saved help question before the next inference; an answer allows a new approach. These conservative comparisons do not claim to recognize every possible unproductive cycle.

Progress commits with accepted builder feedback, report/checkpoint or history selection. A failed progress write is resumable and does not repeat an already journaled tool. Questions use the current claim and ordinary saved-answer boundary; Stop fences late work. Safe terminal-content cleanup prunes the cursors. This metadata cannot grant permission, approve a release, replace a report or mark a task Ready.


## Checkpointed independent validation

Each validation claim captures a package or executes one saved behavior step. The private artifact row keeps a bounded `{step,state}` cursor for its current case. A matching reply advances that cursor atomically with the attempt receipt and usage settlement; only the last passing step appends a completed case. Restart retains earlier checked steps, and a lost reply retries only its unfinished step. The public report remains bound to the exact saved artifact and cannot be supplied by generated code or the browser.

The `service_capacity` and `service_allowance` wait reasons preserve the artifact/cursor and schedule the trusted retry time without sending source for model repair. Stop prevents wakeup and late checkpoints. Startup timeouts use capacity waiting; unavailable transport remains a recoverable execution failure. These are resource-period constraints, not a total goal/model-turn limit.

## Manual Container tests

An owned Container task uses the required `context.container.mode` (`edit`, `test` or `repair`). The same task creation endpoint freezes the exact service draft; a test requires an agreement and selected tests. `drafts/testing.js` selects the existing saved builder tools without model calls. Independent validation remains the sole report authority. Test mode never saves generated source back over the draft, and failure does not enter AI repair. `/api/assistant/tasks/:id/tests` is an authenticated, bounded read of that task's generated output and independent case report; it grants no publication permission.

Hosting records the checked draft revision in the release identity. The service host rejects first activation when a newer draft has been saved. A previously retained release can still be selected explicitly for a safe rollback under the current operation/state checks. Publication, test diagnostics and task completion use existing journals; there is no separate manual-test runner or service registry.

## Research while a question is pending

A build task may remain queued/running with one unanswered question only for its saved `ask_research` batch. The research journal admits the exact saved cursor/call; workspace admission denies pending questions. The checkpoint then waits for the answer. An answer to a queued/running question preserves the active claim and its reservations; it does not cancel the independent read or advance dependent work. Stop/recovery and immutable answer receipts retain their existing ownership and replay rules.

Account metadata uses `server/connections/catalog.js` in this same owner-bound object. It is private, credential-free and has no public/model write endpoint. Task-owned capability decisions and source notes share `task_research` and its retention, not the account catalog's lifetime. See the [2A research contract](../../../docs/engineering/restyle-research-contract.md) for current status, future secure setup and evidence.

## Private external account setup

`manageConnections` delegates to the focused account connection manager inside the existing owner object. `/api/account-connections` exposes a four-record metadata/details page; `/connect`, `/check`, `/disconnect`, `/attach` and `/invoke` are same-origin authenticated POSTs with closed inputs. Every request must carry `X-Restyle-Owner` matching the authenticated account; this assertion rejects a stale editor after an account switch and never grants access by itself. Only the private setup route accepts a token, which is verified against the fixed provider and encrypted before storage. The model receives catalog metadata and safe typed question/answer references. Workspace/source/PVO paths cannot read the credential table. The server operator supplies a separate `ACCOUNT_CONNECTION_KEY` secret. See [the complete connection boundary and evidence](../../../docs/engineering/restyle-account-connections.md).

## Manual alternatives and follow-up

See the [current 2D contract](../../../docs/engineering/restyle-manual-alternatives.md). The builder proposes a researched alternative before freezing its agreement; the existing saved question records explicit consent. `manualPlans` retains accepted proposals and creator-only completed/cancelled resolutions. `ready` means the prepared component exists; pending human work stays visible and keeps task content retained without running compute. Only after every human step is resolved and automatic work is terminal does normal retention start.

Repair mode extends the same draft/workspace/validation/hosting flow with a frozen safe baseline, evidence-backed diagnosis, original-code regression countercheck and independently checked inactive update. It preserves the original agreement and service identity; account faults get a recovery report. Manual conflicts reset baseline/diagnosis on the newer draft. `GET /api/assistant/tasks/:id/tests` returns the existing `tests` projection plus `repair` (null for ordinary edit/test tasks). See [maintenance and acceptance](../../../docs/engineering/restyle-maintenance.md).
