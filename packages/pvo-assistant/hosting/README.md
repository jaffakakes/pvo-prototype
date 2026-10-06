# Hosted service calls

This package defines pure hosted-action, ownership, service-state and usage rules. Public consumers use `index.js` / `index.d.ts`. SQL, HTTP sessions, generated execution, alarms and queues belong to `server/cloud-services/`.

## One service, multiple checked releases

`HostedService` is selected through `SERVICE_HOSTS` by the stable service ID. It owns a bounded set of immutable checked release rows, their independent cancellation tombstones and test state, plus a separate live namespace. Each release retains its exact publication identity. Replaying an older publication cannot change the selected test release; cancelling it cannot delete another release. The shared release contract still verifies all four digests before storage.

The owner catalog in the task coordinator records publication intent and supports owner budgets; it does not expose generated source or become generated code's database. The hosted object owns release selection and atomic service data. No distributed directory or browser-supplied provider address is used.

## Actions and authority

An action contains exactly `{actionId,operation,input}`. IDs are bounded opaque identifiers. The trusted HTTP route supplies creator/public authority and test/live scope separately. Browser flags cannot select live mode, owner identity, saved state or time.

- `POST /api/services/{serviceId}/try` requires the creator's signed session and the editor's exact origin. It uses the selected inactive test release and its own persistent test records.
- `POST /api/services/{serviceId}/actions` admits only an active service's public operation surface. Its CORS permits exported-file/public-player calls and does not grant cookie-based creator permissions. Public requests never gain creator access from a cookie.
- Public and private replies contain only `{actionId,result}`. Entire saved state, owner IDs, source and platform reports are not returned with an action.

Product activation is a later control step. The initial service starts inactive, so its public route rejects calls. Local live-mode isolation tests explicitly set up a trusted active record; this is not a live cloud/product activation claim.

## Saved state, replay and concurrency

The service serializes the complete read/execute/validate/commit operation across awaits. The generated function receives a copy of stored state, its operation/input and platform time. It cannot write storage, read credentials or make network requests. The platform validates the result, state schema and read-only rule before saving anything.

State and the successful action receipt commit in one SQLite transaction. Same ID/operation/input returns the saved answer, including after a full server restart. Changing operation/input under that ID conflicts. Replay still enforces the recorded operation audience. The request's canonical digest is separate from release identity, so a receipt describes the action actually performed.

A process loss before commit leaves no partial state or success receipt. The same ID may rerun pure isolated code, and the earlier admitted attempt remains charged. A process loss after commit returns the retained answer on retry. A queued call rechecks current authority/release. An in-flight result cannot commit after revision, release, expiry or lifecycle changes. Stop aborts inactive work and removes its private test state/receipts.

Test records are keyed by release; live records have their own namespace and are never initialized from test records. A new release cannot silently replace or rewind live data. Durable data and receipts are kept outside the workspace.

## Initial limits

Each service admits at most eight simultaneous/waiting calls. Each test-release/live namespace admits 1,024 calls and 256 new execution attempts per UTC day. Replay consumes a call but no new execution. It retains at most 512 successful action identities and 2 MiB of receipt bytes. New actions fail at capacity; deduplication records are not silently evicted. State/input/result schema and byte bounds remain those of the service package (48 KiB state, 8 KiB input/result, 64 KiB invocation/reply envelope). HTTP action JSON is additionally bounded to 16 KiB.

Usage and state rules live in the shared package; trusted adapters persist them before execution and commit accepted state/results atomically. Runtime invocation remains bounded to two seconds and 50 ms generated-code CPU, with fresh modules and no outbound capabilities. These implementation limits are not a provider billing guarantee.

Creator controls, active lifetime, safe replacement/rollback and component attachment are later roadmap work. Local SQLite/workerd evidence and a beta build do not mean the cloud service is deployed.
