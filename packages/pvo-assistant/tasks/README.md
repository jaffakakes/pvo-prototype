# Saved authoring-task contract

Implemented for [Roadmap 1B.01](../../../docs/engineering/restyle-cloud-agent-roadmaps/1b-saved-tasks.md#1b01--define-the-record-and-legal-changes). In plain terms, this is the format of the agent's notebook and the rules for changing it. The pure package has no effects; the [server adapter](../../../server/assistant/tasks/README.md) owns durable storage and execution.

Import through `packages/pvo-assistant/tasks/index.js`; [index.d.ts](index.d.ts) describes the same public contract. These modules have no UI, network, storage, clock, random-ID, authentication, or provider effects. Parsers return isolated clones and reject missing/unknown fields instead of supporting a second contract.

## Bounded project context

The current contract includes `currentSceneId`, at most 32 scene summaries (`id`, `name`, duration up to one day), and the existing eight component source summaries. Scene IDs are unique, every component belongs to a declared scene, and the current scene exists. Media bytes/URLs and private request bodies stay out of this projection. A component explicitly labels `sourceVisibility` as `full` or `design`; a redacted design is not an editable original request source. This supplies placement and route context for saved component preparation while retaining the 128 KiB input bound.

## Container editing context (1G.03)

The same saved-task runner also accepts `{fingerprint, container: {serviceId, revision, mode}}` instead of scene/component context. Trusted creation reads that exact owned service draft and checks its project and revision. Exact creation replay recovers the original task even after the draft changes. The source snapshot stays in private task storage, outside the small public task record. `mode` is required and is either `edit` or `test`; it is part of creation replay identity. Test mode selects the existing workspace/validation/hosting steps deterministically, uses no inference or source edits, and requires workspace/hosting spending permission. Failed generated or independent tests stop with `tests_failed`; the owner can inspect diagnostics, stop the task, fix the draft and start a new check. A newer draft never changes the frozen revision being tested.

Container planning reads bounded file chunks and proposes full named-file writes or Unicode code-point range replacements. Both use the service's revision-checked draft command. The task saves its exact pending command before dispatch; an uncertain reply retries that identity rather than creating another edit. Newer manual writes produce a saved question and preserve the newer source. Short-lived private execution grants and Stop fences reject delayed writes; unresolved fences retry with bounded deadlines/backoff until confirmed or every possible old grant has expired.

Draft edits/questions start no workshop. A recorded execution reason restores the saved source through the existing builder/workspace tools. Independent validation gates the same immutable artifact; accepted source returns to the same draft and hosting prepares an inactive release on that same service. The `container_draft` result identifies saved code, never component mutations, live activation or publication authority. Browser closure leaves the task running; Stop retains saved source and the live version. This stage still uses the existing generated-service runtime; the Node replacement is 1G.04.

## Public functions

| Function | Responsibility |
| --- | --- |
| `parseTaskProposal(value)` | Validate the native model's bounded behavior examples without accepting effects or identities |
| `parseTaskInput(value)` | Validate the creation operation key, server project ID, original request, expected behavior examples, and bounded component context |
| `parseTaskReference(value)` | Validate a private `{ ownerId, projectId, taskId }` locator with the same bounded IDs; it carries no authorization or task contents |
| `createTask(input, metadata)` | Create a queued record using a trusted owner, new task ID, timestamp, and input digest |
| `parseTaskRecord(value)` | Validate a complete stored record, including consistency between its state, claims, questions, receipts, and result |
| `replayTaskCreation(task, input, metadata)` | Check an existing task found by owner and creation operation ID; reject changed input or digest and return the same record |
| `transitionTask(task, command, guard)` | Validate one legal change and return a new record; reject stale revisions, claims, or ownership |

`TASK_LIMITS`, `TASK_STATES`, and `TASK_FAILURES` are frozen public constants. Failures use fixed codes and a step ID; arbitrary provider error text is excluded.

Trusted adapters supply IDs, nondecreasing millisecond timestamps, and lowercase SHA-256 input digests. They must compute digests from canonical validated inputs; operation digests must include the effect's kind, target, and arguments. A digest is an identity check, not evidence that an effect succeeded. Duplicate creation also compares the actual validated input, independent of object property order. Original request/context/examples cannot be changed by a transition.

## Ownership and concurrency

Creation input cannot carry an owner. A server adapter must derive `ownerId` from the existing account session and verify that `projectId` belongs to that account. A local editor `localId` is not a server project identity. [1B.02](../../../docs/engineering/restyle-cloud-agent-roadmaps/1b-saved-tasks.md#1b02--link-the-notebook-to-the-local-draft) adds a local draft association that consumes this contract; the owned server routes enforce this independently.

Every transition requires `{ ownerId, expectedRevision, now, claim }`. The owner and revision must match the stored task, and `now` cannot move backward. Each change increments the revision. An exact receipt or answer replay returns the original record without advancing it; it still requires the current guard. After a revision conflict, the adapter must reload and evaluate replay against the latest record.

A worker also needs a matching claim ID and execution generation whose lease has not expired. Claim/release/recovery increments the generation so a delayed result from an earlier worker is rejected. Stop removes the claim immediately in the returned record. **The storage adapter must atomically persist with the expected revision before performing effects.** These pure checks alone cannot serialize two callers or interrupt a command already executing.

Creator-facing routes may expose only their named operations after authentication. `claim`, `recover`, and `reconcile_operation` are trusted coordinator commands; worker commands require a current claim. Do not accept an arbitrary `TaskCommand` union from a browser or generated model output. The owner field and `claim: null` are not authorization by themselves.

## States and commands

| State | What can happen next |
| --- | --- |
| `queued` | Coordinator claims due work; creator stops it |
| `running` | Worker checkpoints to `queued`, asks a question, completes, or fails; creator stops it; coordinator recovers an expired claim |
| `waiting_for_answer` | Creator answers to queue the same task or stops it |
| `waiting` | Trusted capacity/spending reason with a scheduled `nextRunAt`, or null for permission; a due claim or creator Resume rechecks admission |
| `ready` | Build attempt is terminal; applying the prepared result is a separate guarded editor operation |
| `failed` | Creator resumes a retryable failure after reconciliation, or stops it |
| `stopped` | Build attempt is terminal; no new work or result may start |

An already due queued wakeup may precede the latest bookkeeping update; reconciliation must not silently postpone it. `recover` preserves unknown effects and queues another worker without a goal-wide retry ceiling. The goal retains its original request, answers, current step, source and receipts. There is no timer in this module: the coordinator arranges worker wakeups and terminal-content deletion. No goal-age deadline ends unfinished work.

Each new question starts at revision 0 with `answer: null`. Answering stores an operation ID and timestamp and advances its revision to 1. Prompts are immutable; a correction needs a new question identity. Choices are suggestions; a bounded free-text answer is allowed. Exactly one unanswered question is permitted while waiting. Stopped tasks may retain that unanswered question. The recent question window normally holds eight answered questions plus the current unanswered question; it keeps fewer when serialized byte pressure requires earlier archiving. `archivedQuestions` counts older answered questions saved immutably outside the current record. Checkpoint writes and archived answers commit together. A final byte check also handles valid long or escaped answers without dropping the just-answered question or overflowing the current record. Question/answer IDs remain reserved forever within the retained goal, and an old exact answer replay does not advance or answer a different question.

Prepared results contain an artifact reference and the original project fingerprint. Prepared component artifact contents use the separate [results contract](../results/README.md) and owned server storage. Trusted build validation reports remain a later builder responsibility. The contract checks reference shape and fingerprint consistency; it does not compile generated source or prove its behavior. Existing project fingerprints are opaque change tokens, not SHA-256 strings. The editor must recheck its current draft before applying a result.

## Effect receipts and usage

Before an effect, a worker records an empty `planned` intent with a unique operation ID, step ID, input digest, and timestamps. A later receipt can become `unknown`, `completed`, `absent`, or `failed`. A lost response must become `unknown`; it must not be treated as confirmed absence.

The same operation ID cannot change its input digest, step, or creation time. Settled receipts are immutable, exact repeats are harmless, and known resource references cannot be discarded. A new attempt requires a distinct operation ID. One unsettled effect blocks another fresh intent, a normal checkpoint, a question, or completion. The current record holds a bounded recent window. `archivedOperations` counts settled receipts removed by a checkpoint. The server must archive every removed receipt atomically before committing that smaller record; a failed archive write rolls back the task change. Unknown/planned receipts and unsettled usage remain current. Owned journals preserve exact outcomes and replay identities for the full unfinished goal lifetime.

Stop and claim recovery convert still-planned receipts to `unknown`. A trusted coordinator can use `reconcile_operation` to update an existing receipt when the task is no longer running, including after Stop. It cannot create another operation or restart the task. The adapter must verify the actual provider outcome and resource ownership before supplying that update. Persist intended provider targets separately, keyed by the stable task/operation identity, before making the request; this generic reference contract does not contain provider credentials or arbitrary provider payloads.

`reserve_usage` holds model/tool capacity before calls. `settle_usage` accounts for consumed capacity or returns an unused reservation. Model and tool counts are accounting, with no fixed goal-wide turn/call ceiling. Normal checkpoints, questions, and completion require settled reservations. Failures, interruptions, and Stop preserve uncertain reservations. They must not automatically refund a call that may already have run. Account-wide money/capacity accounting, terminal reservation reconciliation, and resource cleanup are later adapter responsibilities; these counters are not a global spending cap.

## Bounds and private data

| Field or collection | Current bound |
| --- | --- |
| Opaque IDs | 128 ASCII characters, letters/digits/underscore/hyphen |
| Request / each example input or expected output | 4,000 / 2,000 UTF-8 bytes |
| Examples / component summaries | 8 / 8 |
| Each source section / project fingerprint | 20,000 / 128 UTF-8 bytes |
| Aggregate input / entire task record | 128 KiB / 256 KiB of serialized JSON |
| Current questions / suggested choices per question | At most 16 / 6; answered history checkpoints near eight recent questions, with no goal-wide question ceiling |
| Question / choice / answer | 2,000 / 200 / 4,000 UTF-8 bytes |
| Current operation receipts / resource references per receipt | At most 64 / 8; settled receipts move to the separate immutable archive while the current window normally stays near 32 |
| Artifact | Opaque ID, SHA-256 digest, positive size at most 1 MiB; contents stored separately |
| Goal lifetime / finished-content retention | Unfinished goals do not expire; Ready or Stop sets `finishedAt`, then `expiresAt = finishedAt + 7 days` |
| Execution lease / retries including recovery | At most 60 seconds per worker / accounted without a goal-wide ceiling |
| Model-turn accounting | Nonnegative safe integers; no fixed per-task turn cutoff |
| Used plus reserved tool calls | Nonnegative safe integers; no fixed per-task call cutoff |

These are initial product bounds; 1A diagnostic limits do not set product policy. The record uses exact required fields and explicit `null` for absent optional data. It accepts plain JSON objects and dense arrays, rejects accessors and extra properties, preserves exact source strings, and returns errors without echoing input values or unknown field names.

Questions, source, and artifact references are private task data, not an automatic public/model projection. Closed schemas exclude added credential/header fields but cannot detect secrets pasted into prose or source. Future adapters must use the existing safe context projection and the separate private connection flow; do not copy raw private request-bearing component source into model context.

## Verification and next layer

`node --test tests/assistant-tasks/*.test.mjs` covers validation and byte/count limits, JSON round-trip, unchanged inputs, legal lifecycle changes, owner/revision/lease conflicts, question and creation replays, bounded usage, effect intent/uncertainty/settlement, cancellation, long goal lifetimes, terminal retention, and the public TypeScript declarations. Tests use injected time and effects represented as data; no provider calls occur.

Server task storage, HTTP authentication, atomic compare-and-swap, hashing, alarms, provider reconciliation, artifact validation, and editor result application are not implemented here. Local draft locators are handled by 1B.02; continue with [storage and owned routes in 1B.03](../../../docs/engineering/restyle-cloud-agent-roadmaps/1b-saved-tasks.md#1b03--store-the-task-and-expose-owned-operations). A saved locator does not mean the task itself is already running on a server.

### Interrupted usage bookkeeping

`reconcile_usage` is a trusted coordinator command with `{operationId, modelTurns, toolCalls, consumed}`. It requires a null claim guard, no running worker, an existing settled operation and no remaining uncertain operations. It can settle already reserved usage after Stop or expiry; it cannot reserve new work or restart a task. Storage adapters must atomically journal whether that operation's reservation has already been settled. There is no HTTP/model route for this command. Worker-owned usage still uses `settle_usage` under its live claim.

## Native handoff and local creation replay

`parseTaskProposal` accepts only one to eight bounded, uniquely identified expected-behavior examples. Native model output cannot choose task/project/account identities, providers, URLs, code or credentials. The server gates this handoff by real capability and signed session; the editor rejects it after native changes have been prepared. The proposal itself creates no task or external effect.

The editor stores an exact pending `TaskInput` beside its local checkpoint before POST, replays it after an uncertain response, and removes it after `replayTaskCreation` confirms the matching owned receipt. Completed local associations contain IDs only. Pending inputs are outside Undo/export, are bounded by this contract and are stripped from independent project copies. No media bytes are added to these inputs. See the [editor lifecycle](../../../docs/engineering/restyle-cloud-agent-roadmaps/1b-saved-tasks.md).

## Saved capacity waits

`TaskRecord.wait` is required and null outside `waiting`; inside it contains one approved `reason`. A trusted worker uses `{kind: "wait", reason, nextRunAt}` after settling its operations and usage. Model/workspace capacity and allowance waits need a future wakeup; spending permission has none. Stop clears the wait and fences all later claims. Resume queues the same goal for fresh authorization; it never grants credit or skips reservation. Waiting tasks still consume retained active-task storage, preserve their original input/cursor/history, and have no goal expiry. Model output cannot issue this platform command.

### Independent research and a saved question

The trusted `ask_research` transition is build-only. It saves one question and queues the already saved independent research batch; queued/running/waiting/failed build records can retain that pending question. Answering while the batch is active preserves the worker claim. A checkpoint with an unanswered question can only stay in build and becomes `waiting_for_answer`. Completion/hosting cannot carry it forward. Stop preserves the question and remains terminal. The research adapter admits only the saved read calls and the workspace adapter rejects pending questions; no extra model turns or dependent effects run while waiting. See the [research contract](../../../docs/engineering/restyle-research-contract.md).

## Typed account questions

A private setup question adds `connection: { provider: "github", repository }` to the ordinary saved question. Its trusted answer can add `connectionId`; it contains no credential. The server-only `answer_connection` transition uses the same claim, revision, archive and queued-resume rules as answering a question, preserving completed operation receipts. The creator text route only accepts the explicit choice to continue without this connection; it cannot choose a connection ID or claim successful setup. The authenticated manager verifies owner, provider, exact repository and connected status before answering. See [account connections](../../../docs/engineering/restyle-account-connections.md).

## Manual alternatives and follow-up

See the [current 2D contract](../../../docs/engineering/restyle-manual-alternatives.md). The builder proposes a researched alternative before freezing its agreement; the existing saved question records explicit consent. `manualPlans` retains accepted proposals and creator-only completed/cancelled resolutions. `ready` means the prepared component exists; pending human work stays visible and keeps task content retained without running compute. Only after every human step is resolved and automatic work is terminal does normal retention start.
