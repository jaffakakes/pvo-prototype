# Hosted service calls

This package defines pure hosted-action, ownership, service-state and usage rules. Public consumers use `index.js` / `index.d.ts`. SQL, HTTP sessions, generated execution, alarms and queues belong to `server/cloud-services/`.

## One service, multiple checked releases

`HostedService` is selected through `SERVICE_HOSTS` by the stable service ID. It owns a bounded set of immutable checked release rows, their independent cancellation tombstones and test state, plus a separate live namespace. Each release retains its exact publication identity. Replaying an older publication cannot change the selected test release; cancelling it cannot delete another release. The shared release contract still verifies all four digests before storage.

The owner catalog in the task coordinator records publication intent and supports owner budgets; it does not expose generated source or become generated code's database. The hosted object owns release selection and atomic service data. No distributed directory or browser-supplied provider address is used.

## Actions and authority

An action contains exactly `{actionId,operation,input}`. IDs are bounded opaque identifiers. The trusted HTTP route supplies creator/public authority and test/live scope separately. Browser flags cannot select live mode, owner identity, saved state or time.

- `POST /api/services/{serviceId}/releases/{releaseId}/try` is the component test route. The server derives `component_test` authority from the signed session and exact editor origin, requires the current selected test release, and admits only public operations. Payload flags cannot select live records or private creator operations; private creator receipts cannot be replayed here.
- `POST /api/services/{serviceId}/try` requires the creator's signed session and the editor's exact origin. It uses the selected inactive test release and its own persistent test records.
- `POST /api/services/{serviceId}/actions` admits only an active service's public operation surface. Its CORS permits exported-file/public-player calls and does not grant cookie-based creator permissions. Public requests never gain creator access from a cookie.
- Public and private replies contain only `{actionId,result}`. Entire saved state, owner IDs, source and platform reports are not returned with an action.

A service starts inactive. Creator controls below activate its checked release; local live-mode tests use the real activation API. No live cloud/product deployment is implied.

## Creator controls and lifetime

`GET /api/services` lists the signed-in owner's services across projects; `GET /api/services/{serviceId}` inspects one. `POST /activate`, `/pause`, `/reset_test` and `/delete` under that service require the owner's signed session and exact editor origin. The command contains only `kind`, `actionId`, `expectedRevision`, plus `releaseId` for activation or test reset. `POST /operate` runs a creator operation against active live records; `/try` always uses separate test records. Public `/actions` never borrows creator permissions from a cookie.

The hosted object atomically commits lifecycle, selected release and a small control receipt. Concurrent stale revisions fail. The latest 64 control receipts replay exact commands; an unchanged command older than that window fails its original revision check. Replay returns the original receipt with **current** service status. Control receipt trimming never evicts viewer action receipts. Pause/delete remain available even when action storage is full.

Activation retains the checked source independently of the build task. Pause blocks live calls and keeps source/data; creator Try remains separate. Task Stop/deadline cleanup can remove only inactive releases, returning `retained` for an activated release rather than falsely reporting deletion. The provider journal then discharges its inactive-cleanup obligation without retaining a finished task forever. Other abandoned releases still expire. The hosted lifecycle is authoritative; the owner catalog is a revision-fenced, conservatively refreshed index for ownership and quotas. An unavailable provider never proves deletion or frees capacity.

Explicit service deletion removes every source bundle, test/live state, action result and usage record. Bounded identities, digest references and small control receipts remain as tombstones; delayed publication cannot revive the service. Editor Undo and local component/project deletion do not delete a service or undo viewer submissions. Active and paused source/data otherwise remain until explicit deletion, within the fixed storage bounds.

In **More → Containers**, creators inspect, activate, explicitly confirm pause, resume and explicitly confirm deletion. The account-scoped panel saves an unresolved control in browser storage before sending. Reload retries the same ID/revision; an account change discards in-flight presentation and cannot show another owner's records. A lost reply does not grant permission to invent a second action.

## Saved state, replay and concurrency

The service serializes the complete read/execute/validate/commit operation across awaits. The generated function receives a copy of stored state, its operation/input and platform time. It cannot write storage, read credentials or make network requests. The platform validates the result, state schema and read-only rule before saving anything.

State and the successful action receipt commit in one SQLite transaction. Same ID/operation/input returns the saved answer, including after a full server restart. Changing operation/input under that ID conflicts. Replay still enforces the recorded operation audience. The request's canonical digest is separate from release identity, so a receipt describes the action actually performed.

A process loss before commit leaves no partial state or success receipt. The same ID may rerun pure isolated code, and the earlier admitted attempt remains charged. A process loss after commit returns the retained answer on retry. A queued call rechecks current authority/release. An in-flight result cannot commit after revision, release, expiry or lifecycle changes. Stop aborts inactive work and removes its private test state/receipts.

Test records are keyed by release; live records have their own namespace and are never initialized from test records. A new release cannot silently replace or rewind live data. Durable data and receipts are kept outside the workspace.

## Initial limits

Each service admits at most eight simultaneous/waiting calls. Each test-release/live namespace admits 1,024 calls and 256 new execution attempts per UTC day. Replay consumes a call but no new execution. It retains at most 512 successful action identities and 2 MiB of receipt bytes. New actions fail at capacity; deduplication records are not silently evicted. State/input/result schema and byte bounds remain those of the service package (48 KiB state, 8 KiB input/result, 64 KiB invocation/reply envelope). HTTP action JSON is additionally bounded to 16 KiB.

Usage and state rules live in the shared package; trusted adapters persist them before execution and commit accepted state/results atomically. Runtime invocation remains bounded to two seconds and 50 ms generated-code CPU, with fresh modules and no outbound capabilities. These implementation limits are not a provider billing guarantee.

Component attachment and later update-authoring workflows remain roadmap work. Local SQLite/workerd evidence and a beta build do not mean the cloud service is deployed.


## Updating and returning to a version

Activation can choose any available or retained checked version owned by the same service. Before switching, trusted code validates the **current** live records against that version's state schema/byte limits and compares operation names, audience, storage access, inputs and results with the active version. Descriptions and field/operation ordering may differ; changing the client interface is rejected in this initial update path. Generated source and caller flags cannot waive these checks.

Live records are initialized from the first activated agreement, independently of test records. Another version's initial values never overwrite them, even when no viewer action has happened. The selected release, retained bytes and control receipt commit atomically after validation; failure leaves the existing program, records and receipts unchanged. The prior working bytes remain retained, and version choices are shown under **Container details** in the manager.

Returning to a previous version runs the same checks against today's records. It never restores earlier data or removes later viewer actions. A narrower old schema can therefore prevent rollback after newer records have accumulated. Existing action IDs still replay their original results across version changes. Changing versions fences an execution already in flight; an uncommitted action can retry against the newly selected version without duplicating a saved change.

This is the checked host/version mechanism. The later update-authoring roadmap connects a new authoring task to an existing attached service. The current four-version bound includes retained identities/tombstones; it is not an unlimited release history. No actual provider deployment is implied by local tests.

Container checks bind `draftRevision` in each release identity (`null` for a component-building task without a draft target). Owned summaries include the current draft revision. First activation of a draft-bound release requires that revision still to match, checked in the same transaction as control replay, state validation and selection. A stale test leaves the live release unchanged. Retained versions remain available for explicit compatible rollback; selecting prior code never restores older records.


## Private records and allowed cleanup

`GET /api/services/{serviceId}/records` requires the signed-in owner and reads one transaction in the existing service host. It never executes generated code or consumes an invocation allowance. The closed response contains the service/revision, observation time, live records and each available release’s separate test records. Each area distinguishes stored from initial state, includes its current UTC-day calls/executions and retained reply count/bytes, and returns at most five recent saved results and eight recent failure codes. Textual JSON preserves complete bounded records/results for inspection without exposing request input, generated error text, source or credentials. Total response is bounded to 1 MiB. It is diagnostic data, never release authority or a provider bill.

Failures are bounded per namespace and survive host restart. Only requests admitted to an available owned/public operation boundary are eligible: sign-in rejection, unavailable release and queue rejection are excluded. Failed calls log a fixed safe code and operation/action/release/time, never private input or exception text. A logging failure cannot replace the original action outcome. Successful replies remain the atomic replay receipts, not a second log. Explicit deletion and expired-test cleanup remove the corresponding failure diagnostics.

The allowed non-destructive cleanup is **Reset test records**, confirmed separately for one checked release. The existing revision-fenced control transaction restores that agreement’s starting test state and fences in-flight commits. It leaves live records, selected versions, usage, failure diagnostics and successful replay receipts intact. Old action IDs return their original result; a new test action uses a new ID. Reset is available while paused and does not reactivate the service. Lost reset replies recover the exact saved control through restart; stale or altered commands fail. Removing live records requires explicit service deletion. There is no arbitrary database editor or implicit data migration.

The screen explains pause/deletion and the limits of editor Undo before committing controls. Pausing blocks new live submissions and unfinished commits, preserving accepted records/replies/source. Deletion removes them permanently and breaks exported copies. Background viewer jobs and external side effects are not enabled in this milestone; their later roadmap extends these same controls.
