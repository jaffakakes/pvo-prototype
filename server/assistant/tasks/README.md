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
| `POST /api/assistant/tasks/:id/answers` | `{expectedRevision,questionId,questionRevision:0,operationId,value}` | `{task}` |
| `POST /api/assistant/tasks/:id/resume` | `{expectedRevision}` | `{task}` |
| `POST /api/assistant/tasks/:id/stop` | `{expectedRevision}` | `{task}` |

Lists are bounded traversals, not a frozen snapshot during concurrent creation. Unknown extra query/body fields are rejected. Task input is bounded by the shared 128 KiB maximum. Question values support free text, including with suggested choices. Another owner's task/project returns the same 404 as an absent one. Anonymous access returns 401. Incorrect/stale state returns 409; refetch the task before deciding whether to retry. An exact repeated answer uses the **current task revision** and original answer identity/value, returning unchanged state. Stop is terminal for that task attempt.

The HTTP response carries the validated shared record. It contains the creator's request, bounded component source, answers and internal locators, so it must remain account-private. This API never places credentials in those records. Callers must use future private connection flows for credentials; the schema does not detect a secret pasted into ordinary prose.

## Atomic storage and limits

Project resolution, creation identity, capacity checks and insertion happen in the same storage transaction. Canonical JSON key ordering produces a SHA-256 creation digest; replay also compares the actual validated input through the shared contract. Mutations load current state, validate the expected revision and use a conditional revision update. SQL changes and the next retention alarm commit together. There are no provider effects inside a storage transaction.

Per owner: 64 project associations, 32 retained full task records, two unfinished tasks, eight creations per UTC day, and 4,096 lifetime compact creation identities. Resume checks the unfinished-task capacity too. Replays do not consume new capacity. The runner must separately reserve inference/tool capacity before effects; these storage bounds do not authorize model usage.

At 24 hours unfinished tasks become `failed/deadline_exceeded`. At seven days, settled task content is removed. Compact creation identity rows (task ID, creation operation ID, project ID and creation time) remain within the 4,096 limit. Replaying an expired creation returns 410 instead of silently starting new work. Project associations remain bounded and stable; retaining them prevents a reopened local draft from being silently assigned a different server project.

An unresolved operation or reserved usage prevents content deletion until trusted reconciliation finishes. Expired content is hidden by the public API even while its private bookkeeping is retained. There is no browser route to clear an uncertain receipt. The inference journal now settles interrupted planning usage through trusted `reconcile_usage`; later deployment/provider adapters must reconcile their own external outcomes through a trusted path; retention must never destroy the only evidence of a possibly completed action.

Storage behavior follows Cloudflare's [SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction) and [persisted alarms](https://developers.cloudflare.com/durable-objects/api/alarms/). `wrangler.jsonc` registers the new SQLite class; that registration is provider setup, not support for an alternate project/task format.

## Verification and current scope

`node --test tests/assistant-task-server/*.test.mjs` uses the actual application HTTP router, signed account cookies, local D1, and workerd SQLite Durable Objects. It destroys and recreates the whole Miniflare runtime against a disk persistence directory, retaining projects/tasks/questions/answers/capacity. It covers concurrent creates, answer/Stop revision races, cross-account access, origin failures, unavailable bindings, bounded inputs, deadlines, private-content retention and idempotency after expiry. The test subclass has private controls to supply time and simulate a trusted step; none are exported by the product Worker.

1B.03 stores and manages tasks. **1B.05 now executes saved planning independently of the browser.** Backend intent routing and the editor task screen remain 1B.04/1B.06. The Node static beta server does not yet expose the Worker task API. Reaching the `build` checkpoint currently records `provider_unavailable`; arbitrary workspace construction is 1C and cannot be reported as a completed build here.

## Saved planning runner (1B.05)

A durable alarm acquires a 60-second execution claim and processes at most two planning steps per invocation. Before invoking the provider, it saves a SHA-256 input digest, a stable inference identity, and one task model-turn reservation. It reserves from the existing daily `AssistantBudget` with an account hash and an idempotent operation hash. Foreground and saved work share the 60-request service allowance; saved work has a 20-per-owner daily and 12-per-minute allowance, while foreground requests retain their existing address-based client allowance. Task limits still permit at most six total model turns, including outstanding reservations.

Each inference has a 45-second outer deadline, even if the provider ignores cancellation. The last dispatch check rereads the persisted execution generation synchronously immediately before the model call. Stop commits first, invalidates the generation, and aborts the active local signal. Late replies cannot ask a question, mark ready, advance a step or start another inference. A cancelled step can settle its already-recorded usage/receipt without restarting the task.

Planning uses the existing configured model adapter. Its only accepted outputs are a bounded follow-up question or a request to advance to `build`. It cannot execute model tool calls, deploy, send messages, provide a service URL, or invent a ready receipt. Questions get server-assigned IDs. The model sees the original bounded input and saved answers; platform credentials never enter its context.

The journal records whether invocation was dispatched. Proven unused capacity is released. An interrupted dispatched inference is charged conservatively and its unrecorded answer is discarded; expired claims may retry within the shared three-recovery limit. This is safe only because this adapter performs read-only planning inference. An unknown deployment, booking or message must use the separate provider reconciliation required by 1B.08/1B.09; it must never adopt this inference recovery rule.

Account settlement is idempotent, including cancellation arriving before a delayed reservation. A budget object retains at most 4,096 compact reservation identities per day. Each alarm performs at most four settlement calls, each bounded to five seconds. Failed settlements retry twice with backoff; after the third failure they wait for that UTC budget's expiry, keeping capacity conservatively occupied. Task journals remain until usage bookkeeping and task-content retention both permit removal.

The browser lifetime check is `node scripts/checks/cloud-agent-tasks/browser-lifetime.mjs`. It closes Chromium during a controlled server step, then opens another browser context and reads the same saved question from real local workerd/D1/SQLite. It is a server-lifetime harness, not the new editor task UI or a live model/provider build. The Node runner suite separately destroys workerd during active inference, recreates it from disk, and proves that only the recovered claim's answer is accepted.
