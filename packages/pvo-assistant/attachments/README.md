# Checked component connections and saved submissions

The attachment contract binds one component proposal to an owned checked release. A parsed receipt or saved connection is data, not permission to activate or invoke a service. The server still checks current ownership, operation, release state and input.

## Shared submission contract

Try and the player use the same `ServiceSubmission` record:

- `target`: platform origin, service/release identifiers, one public operation's description and input/result schemas, and local replay scope. Try includes the current creator ID; public submissions contain `ownerId: null`.
- `action`: the server's existing `{ actionId, operation, input }` envelope.
- `response`: `null` while unresolved; the checked `{ actionId, result }` after success.

`prepareServiceSubmissionTarget` projects this target from a checked component connection. It drops task/project ownership, generated source, private state, tests and readiness timestamps. The projection does not activate the service or authorize a call. Public export of this descriptor is separate later work.

`resolveServiceSubmissionInput` reads the connection's literal, field, array and object bindings. Form values must already be typed by the host. It rejects missing fields, getters, inherited fields, incorrect types/ranges and oversized values. It never evaluates code, interpolates templates or converts `"false"` into a boolean.

## Required host sequence

1. Capture the current account/project/component and connection. Derive Try scope from the signed-in host account, or public scope from the player. Never accept scope or credentials from generated component payloads.
2. For a distinct submission, generate a fresh unpredictable ID with the host's `crypto.randomUUID()`. Resolve the actual input once and call `prepareServiceSubmission`.
3. Persist the returned record before sending anything. If persistence fails, do not dispatch. Storage keys must distinguish the owning client/project/component; the saved target must still match the current context when recovered.
4. `serviceSubmissionRequest` produces canonical POST bytes and the fixed `/api/services/{serviceId}/releases/{releaseId}/try` or `/api/services/{serviceId}/actions` route. The transport adapter owns allowed-host checks, deadlines, cancellation and bounded response reading. Try credentials require the platform's same-origin authenticated route; public requests omit credentials. The server derives authority from the route/session, never a client mode flag.
5. A lost/invalid reply leaves the record unresolved. Retry calls `retryServiceSubmission` with the saved record and current target; it does not read the form again, change input or create another ID. Changing origin, account, mode, service, release or operation rejects that retry.
6. Validate the response with `completeServiceSubmission`, then persist it against the exact current intent before announcing success. A different action ID, invalid result or conflicting completed result is rejected. Late replies must not overwrite a newer intent or update an inactive component/account.
7. A completed record can show its saved result without another request. A new explicit submission gets a new ID even if its input equals the previous submission. Do not silently replace an unresolved intent with new form input.

Parsing a locally modified record grants no authority or integrity guarantee. Server action receipts reject reuse of an existing ID with changed input and replay the original result without running generated code again. The server remains responsible for business-state changes and test/live isolation.

## Shared client and browser adapter

`createServiceSubmissionClient({ store, createId, send })` owns the persist/send/complete sequence. `submit` captures and validates target/input synchronously before waiting for storage. Identical unresolved input reuses its ID; changed unresolved input is rejected. `retry` restores the saved intent, and a completed result returns without a network call. A distinct submission after completion requires a fresh ID.

The store's `update(slot, change)` must serialize read/change/write across clients and resolve after commit. `openServiceSubmissionStore()` supplies that contract through actual IndexedDB transactions. Its owner must close the database when the host session is disposed. Storage failures prevent dispatch. The host supplies a stable, scoped slot and must never erase an unresolved intent to start a new one silently.

Every operation requires `isCurrent()` and optionally an abort signal. Check the account, local project, component/connection and active interaction there. An authoritative response may settle only its own unchanged record after cancellation; stale completion still rejects before the host can apply UI/routes. A newer saved intent cannot be overwritten by that late response.

The host's `send` adapter receives canonical wire bytes and must transmit them without PVO template interpolation. Record completion before returning success to the SDK request lifecycle, so success routes cannot run ahead of a failed storage write. HTTP errors, invalid replies and ambiguous responses keep the saved action retryable. Avoid dispatch through an authored arbitrary URL; match the exact checked connection and fixed platform route first.

## Current verification and remaining adapters

Pure contract tests cover serialized recovery, exact input/bytes, typed bindings, changed scopes, invalid/late results and immutable completion. Actual local HTTP/workerd/SQLite tests cover lost responses, full server restart, replay, changed-input conflict, distinct submissions and Try ownership for both routes. Public TypeScript declarations are checked by a consumer fixture.

The common client and IndexedDB adapter are verified with storage failures, concurrent callers, late replies, cancellation, client recreation and actual server replay. A fresh Chromium profile survives a complete browser shutdown/restart; two tabs serialize competing submissions, transaction rollback preserves the old record, and closed storage sends nothing. The browser script uses controlled responses; the separate HTTP tests use the real local service host.

Try now uses account/local-project/component/control-scoped storage, exact live request matching, current-context guards and the dedicated server test route. The player wiring and explicit recovery presentation remain **1E.04** work. Public export/activation remain **1E.06–09**. The shared contract alone does not make an exported component usable.

Component Try uses a dedicated server-derived authority restricted to the owner, expected test release and public operations. The general creator `/try` management route is not a component capability. HTTP acceptance rejects foreign/anonymous sessions, changed origins/releases, private operations and payload authority flags before generated code runs. Test and live records remain separate across restart.


## Try host integration

The editor resolves actual typed form values before opening storage. Its checked request is intercepted by a private callback registered for the SDK interaction; arbitrary generated payloads cannot register one. The transport accepts only the fixed same-origin release-specific test route, uses the creator session, rejects redirects and bounds JSON decoding. The SDK still owns request deadlines, ordinary allowed-domain policy, diagnostics, response state and playback routes. Completion commits before SDK success. Literal user input is never passed through PVO template resolution again.

The host closes each owned IndexedDB connection. Stop or a changed account/project/component invalidates late outcomes; a returned authoritative response may settle only its own record. A retry from failed request/playback feedback reads the saved action/result, including a completion that reached storage before a playback-route failure. Starting a new Try is an explicit new test: an unresolved identical submission still reuses its ID; changed unresolved input cannot replace it. Dedicated recovery presentation for saved pending details and player integration remain open.


## Public connection description

`projectPublicServiceConnection` explicitly projects a private checked connection into origin, service ID, release ID, one public operation description/schema, event, control target and input binding. `parsePublicServiceConnection` validates that closed shape. Owner/project/task IDs, artifact digests, readiness and private receipts are absent; adding permission or credential fields is rejected.

`publicServiceSubmissionTarget`, `resolvePublicServiceSubmissionInput` and `matchesPublicServiceRequest` reuse the same target, typed input and declarative comparison rules as Try. Parsing this public data grants no activation or server permission. Export must still obtain a matching active connection through the later delivery command; these shared helpers alone do not change manifests or enable the player.
