# Temporary workspace contract

This package defines source snapshots, operation inputs, bounds and pure lifecycle rules for the Restyle build computer. Server adapters import the public `index.js`; `index.d.ts` describes the same contract. It does not allocate computers, authorize creators or mark generated services ready.

## Identity and source

A workspace belongs to one owner, project and saved task. Trusted server code derives `workspace-<SHA-256>` from those identifiers. Source changes, retries and computer restarts keep that identity. Identity contains only those ownership identifiers. Worker deadlines and source retention are separate; continuing a goal cannot alter its workspace identity.

A draft snapshot holds a revision, digest and bounded `{path, content}` files. Drafts can be incomplete or empty. The [service package contract](../services/README.md) defines the accepted `src/` and `tests/` paths and file limits. A complete service package needs its agreement, entry point and tests; a workspace snapshot alone does not satisfy that contract.

Saving requires the expected current revision. Operation identifiers replay their existing result; changed input under the same identifier conflicts. Snapshot digests cover canonical file records including exact source text. Only the latest source snapshot is retained. Save receipts contain its revision and digest, not another copy of every file.

## Execution and cleanup

The saved-task runner must supply an execution claim with its ID, generation and expiry. New writes/starts/commands reject absent, expired, changed or revoked claims. Suspending a claim records its revocation even before a delayed request arrives. A newer claim may restore the same saved source; a delayed suspension of an older claim cannot stop that newer session.

The server journals an action and its compute reservation before an external effect. There is at most one active action. A start restores authoritative saved files to a fresh computer. `check` runs Node syntax checking on one source/test file; `test` runs at most eight declared test files. These requests cannot specify a shell, environment, provider identity or credentials. Generated tests can execute arbitrary code inside the isolated computer and are untrusted feedback.

| Bound | Value |
| --- | --- |
| Operations, including saves | Counted without a goal-wide ceiling; receipts remain in the owned SQL journal |
| Computer sessions | Counted without a goal-wide ceiling; capacity admission still applies |
| Session lifetime | At most 120 seconds, also capped by the task claim expiry |
| Startup/restoration | 20 seconds |
| Command time | 15 seconds |
| Combined stdout/stderr | 16 KiB of valid UTF-8 |
| Global active sessions | 2 |
| Global new sessions | 12 per UTC day |
| Automatic cleanup attempts | 5, with exponential backoff |

Stop closes the identity before shutdown. An interrupted start/command never silently repeats. A coordinator restart destroys a retained computer, then a new explicit operation may restore the saved source. A source edit also discards the existing computer. Failed shutdown keeps its reservation occupied; time passing alone does not prove that a computer was removed. An explicit trusted reconciliation can retry an exhausted cleanup batch.

Source and receipts remain while the goal is unfinished. Closing the workspace after Ready/Stop starts seven-day content retention. Session expiry only removes the computer; it preserves saved source for a later worker. Reservation identities have their own 24-hour retention, and an unconfirmed deletion keeps its capacity occupied beyond that period. Small identity/tombstone and unresolved cleanup records remain after private content expires. Finished operation receipts are historical results; replaying an old successful start does not recreate a stopped computer.

## Implementation and verification boundary

`server/assistant/workspaces/` owns private Cloudflare Durable Object storage, the global reservation journal, identity hashing and native Container effects. The Container starts without outbound Internet, has no platform bindings and receives only validated source files. Restoring checks filesystem containment and rejects existing files/symlinks. Timeout/failure/Stop destroys the whole computer, including descendants.

The saved-task coordinator now journals workspace calls and per-task tool reservations before dispatch. Its private builder capability derives owner/project/task identity and a current execution grant; callers cannot choose those fields. Lost replies revoke the old claim before receipt lookup. Cleanup obligations survive task retention when deletion is unconfirmed, while expired private output is removed. Cleanup retries stop after five failures instead of creating a hot alarm loop.

`server/worker.js` exports both classes and `wrangler.jsonc` declares their bindings plus `restyle-agent-workspaces`. Product deployment is separate; no model tools are advertised until 1C.04/1C.05. The independent trusted service test gate remains in 1C.07/1C.08.

Local tests use real workerd/SQLite/RPC and runtime restarts with controlled Container effects. The restore program also runs in disposable local directories. The separate [native Container acceptance](../../../docs/engineering/restyle-workspace-provider-proof.md) passed on 5 October 2026; every disposable provider resource was deleted and absence verified.

## Capacity waits

Workspace reservation returns `{accepted:true}` or a trusted `{accepted:false,reason,retryAt}`. Concurrent/journal capacity returns `workspace_capacity`; daily allowance returns `workspace_allowance` with the next UTC day. A closed/expired lease is `lease_closed` and cannot reopen. Denied starts persist an interrupted receipt whose capacity result includes `retryAt`; ordinary interruptions retain only their fixed code. Cleanup remains mandatory, and expiry alone never releases an unconfirmed resource slot.

The saved builder records the real denial, abandons dependent commands, and saves a waiting task. When capacity is rechecked, a new operation starts from the same stored source. Old receipts/lease tombstones remain immutable; reading an old denied receipt does not pause a new work period. Restart and delayed replies preserve these rules.
