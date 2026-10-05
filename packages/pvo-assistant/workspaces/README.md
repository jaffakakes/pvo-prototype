# Temporary workspace contract

This package defines source snapshots, operation inputs, bounds and pure lifecycle rules for the Restyle build computer. Server adapters import the public `index.js`; `index.d.ts` describes the same contract. It does not allocate computers, authorize creators or mark generated services ready.

## Identity and source

A workspace belongs to one owner, project and saved task. Trusted server code derives `workspace-<SHA-256>` from those identifiers. Source changes, retries and computer restarts keep that identity. Deadline and retention are frozen when first stored. Another identity, or a changed deadline for the same identity, is rejected.

A draft snapshot holds a revision, digest and bounded `{path, content}` files. Drafts can be incomplete or empty. The [service package contract](../services/README.md) defines the accepted `src/` and `tests/` paths and file limits. A complete service package needs its agreement, entry point and tests; a workspace snapshot alone does not satisfy that contract.

Saving requires the expected current revision. Operation identifiers replay their existing result; changed input under the same identifier conflicts. Snapshot digests cover canonical file records including exact source text. Only the latest source snapshot is retained. Save receipts contain its revision and digest, not another copy of every file.

## Execution and cleanup

The saved-task runner must supply an execution claim with its ID, generation and expiry. New writes/starts/commands reject absent, expired, changed or revoked claims. Suspending a claim records its revocation even before a delayed request arrives. A newer claim may restore the same saved source; a delayed suspension of an older claim cannot stop that newer session.

The server journals an action and its compute reservation before an external effect. There is at most one active action. A start restores authoritative saved files to a fresh computer. `check` runs Node syntax checking on one source/test file; `test` runs at most eight declared test files. These requests cannot specify a shell, environment, provider identity or credentials. Generated tests can execute arbitrary code inside the isolated computer and are untrusted feedback.

| Bound | Value |
| --- | --- |
| Operations, including saves | 64 per task |
| Computer sessions | 4 per task |
| Session lifetime | At most 120 seconds, also capped by the task claim expiry |
| Startup/restoration | 20 seconds |
| Command time | 15 seconds |
| Combined stdout/stderr | 16 KiB of valid UTF-8 |
| Global active sessions | 2 |
| Global new sessions | 12 per UTC day |
| Automatic cleanup attempts | 5, with exponential backoff |

Stop closes the identity before shutdown. An interrupted start/command never silently repeats. A coordinator restart destroys a retained computer, then a new explicit operation may restore the saved source. A source edit also discards the existing computer. Failed shutdown keeps its reservation occupied; time passing alone does not prove that a computer was removed. An explicit trusted reconciliation can retry an exhausted cleanup batch.

Source and receipts remain until the task retention deadline, including after Stop. Small identity/tombstone and unresolved cleanup records remain after private content expires. Finished operation receipts are historical results; replaying an old successful start does not recreate a stopped computer.

## Implementation and verification boundary

`server/assistant/workspaces/` owns private Cloudflare Durable Object storage, the global reservation journal, identity hashing and native Container effects. The Container starts without outbound Internet, has no platform bindings and receives only validated source files. Restoring checks filesystem containment and rejects existing files/symlinks. Timeout/failure/Stop destroys the whole computer, including descendants.

The main app has not advertised or connected these workspace tools yet. Task coordinator/usage integration, the model builder, external trusted test gate and real provider acceptance remain in [Roadmap 1C](../../../docs/engineering/restyle-cloud-agent-roadmaps/1c-generated-services.md). Local tests use real workerd/SQLite for persistence with controlled Container effects; the actual restore program also runs in disposable local directories. Those tests are not evidence of a real hosted Container run.
