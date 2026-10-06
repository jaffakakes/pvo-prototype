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
4. `serviceSubmissionRequest` produces canonical POST bytes and the fixed `/try` or `/actions` route. The transport adapter owns allowed-host checks, deadlines, cancellation and bounded response reading. Try credentials require the platform's same-origin authenticated route; public requests omit credentials. The server derives authority from the route/session, never a client mode flag.
5. A lost/invalid reply leaves the record unresolved. Retry calls `retryServiceSubmission` with the saved record and current target; it does not read the form again, change input or create another ID. Changing origin, account, mode, service, release or operation rejects that retry.
6. Validate the response with `completeServiceSubmission`, then persist it against the exact current intent before announcing success. A different action ID, invalid result or conflicting completed result is rejected. Late replies must not overwrite a newer intent or update an inactive component/account.
7. A completed record can show its saved result without another request. A new explicit submission gets a new ID even if its input equals the previous submission. Do not silently replace an unresolved intent with new form input.

Parsing a locally modified record grants no authority or integrity guarantee. Server action receipts reject reuse of an existing ID with changed input and replay the original result without running generated code again. The server remains responsible for business-state changes and test/live isolation.

## Current verification and remaining adapters

Pure contract tests cover serialized recovery, exact input/bytes, typed bindings, changed scopes, invalid/late results and immutable completion. Actual local HTTP/workerd/SQLite tests cover lost responses, full server restart, replay, changed-input conflict, distinct submissions and Try ownership for both routes. Public TypeScript declarations are checked by a consumer fixture.

Browser persistence, host-generated IDs, current-context fencing and Try/player wiring remain **1E.04/1E.05** work. Public export/activation remain **1E.06–09**. The shared contract alone does not make an exported component usable.
