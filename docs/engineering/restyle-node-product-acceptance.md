# Roadmap 1: integrated Node/Fly acceptance

[Roadmap](restyle-cloud-agent-roadmaps/1g-containers.md) · [Prior provider evidence](restyle-node-provider-proof.md) · [Progress](restyle-cloud-agent-progress.md)

## Scope and resource plan — 7 October 2026

Finish 1G.04/05/06, 4C.06 and 1G.08 through beta. Preserve the completed 1E/1F and isolated eight-case Fly proof. This test exercises the existing task publication journal, independent validator, service host and Node execution controller together. Fixed reviewed programs make recovery assertions deterministic; they do not claim another live-model demonstration.

Use the same approved US$1 isolated test allowance. One randomly named Fly app in the existing organization, on its own private network; one temporary trusted image builder; one immutable runtime image with the already proved digest; at most 32 Node invocations across the existing two private execution slots. The builder uses one shared CPU/1 GiB, at most ten minutes; guests use the existing 300-second outside lease and 180-second supplemental watchdog. End admission after sixty minutes or 32 reservations, whichever comes first. These are resource limits for this diagnostic, not model or product-goal limits.

One randomly named Cloudflare diagnostic Worker owns four SQLite Durable Object bindings: the existing tasks, host and Node controller plus a diagnostic admission journal. No production route, real customer database, model inference, development workshop, volume, public Fly port or subscription change. Use synthetic owners and reviewed non-personal inputs. The private operator routes require a random token; viewer routes expose only the existing approved public operation. The execution guests receive no credentials or expected answers.

Compute estimate: at the recorded Fly iad rate of US$0.0093006/hour for shared-1x/1 GiB, 32 five-minute reservations plus a ten-minute builder are under US$0.027. Actual runtime should be much shorter. This is not the invoice: registry/root-filesystem storage, transfer, Workers/SQLite, logs and tax are additional; the approved total test allowance remains US$1. Reuse prior isolation/upload evidence rather than repeat those paid cases. No permanent product hosting is authorized by this diagnostic.

## Execution and recovery

1. Dry-run the actual Worker and trusted build tooling; verify fixed source, pinned runtime and admission controls locally before account effects.
2. Establish the previously authorized Fly connection securely. Create only a short-lived app-scoped credential for the new app, retained outside source and runtime guests. Record names/IDs/intents in private journals before each effect. Never recover revoked secrets from old logs.
3. Reproduce and verify the immutable image. Destroy the builder before product execution. Deploy the isolated Worker with that exact image and app-scoped credential.
4. Independently validate the retained Node/library artifact, publish through the actual saved-task journal, deliberately lose the committed publication response, restart and reconcile. Probe the recovered inactive release.
5. Verify owner-only editing/inspection, test/live separation, exact action replay after host and instance restart, updates/rollback, stale/invalid publication rejection, pause/delete and periodic retention. Exercise real editor/compiler/player paths against the integrated provider where practical, with controlled publication storage clearly identified.
6. Fence all new execution before cleanup. Read both durable slot obligations and reconcile/destroy their exact owned Machines. Keep unresolved obligations and credentials until absence is verified. Never remove a namespace while it still owns unconfirmed compute. Then remove the Worker/namespaces, registry manifest, app and short-lived credentials; verify absence. Provider garbage collection of unreferenced registry blobs is reported separately.

The cleanup-only command must reopen the same journals, never create replacement resources. A lost mutation response is inspected and reconciled, not blindly repeated. Preserve unrelated apps, especially `lumo-backend-chrisbec`.

## Completion evidence

Record real check results, runtime/package identities, execution counts/durations, failed attempts, costs/uncertainty and cleanup in progress. Run relevant full source/type checks and actual editor/player acceptance, then rebuild/deliver beta with old hashed assets retained and the served service-worker revision verified. Check each numbered task only when its complete evidence passes. Production remains deferred until the user tests beta and explicitly approves release.

Historical running checkpoint (superseded by the verified result below): Preparation is committed as `524838e`. The first attempt `run-deYEYE` stopped during builder setup and cleaned its Machine/app/key. The corrected attempt is `run-dGfXoa`; its builder reproduced the approved immutable image and was removed before service execution. Cloud journal `workspace-uefOob` records the isolated Worker and four namespaces. No gate is newly checked until checks and cleanup finish.


## Verified result — 7 October 2026

**Passed; all five remaining Roadmap 1 gates are complete through beta.** Source preparation `524838e`, builder correction `c8104e6`, client clock correction `ef1deaa`; active draft [PR #106](https://github.com/jaffakakes/pvo-prototype/pull/106). The fixed diagnostic code proves integration and recovery; the two earlier 1F live-model demonstrations remain separate preserved evidence.

| Gate | Verified evidence |
| --- | --- |
| 1G.04 — hosted Node | Same immutable runtime digest `sha256:9942e6c3dccc44a923c70ef9d8b3b7609b1a8338ea05b33ca80047952d0f449b`, reproduced in 77,337 ms. Nineteen fresh private Node executions used exact retained `nanoid@5.1.6` bytes. Previous eight-case real sandbox, process/network isolation, timeout/output and 900,906-byte upload evidence remains in the provider proof. |
| 1G.05 — trusted checking | Actual independent validator ran the same package/runtime as hosting. Deliberately incorrect code failed without changing the live release. Existing manual/AI draft suites verify identical gates, generated-test forgery rejection, stale source/dependency/runtime invalidation, ownership and test/live separation. |
| 1G.06 — durable hosting | A crash after publication recovered the original saved deployment identity. Host restart retained source/data and exact action/control replies. Compatible update and rollback preserved current data. Machine `869292ce726618` was interrupted after its identity was saved; durable cleanup released both slots, and retrying the original action recovered correctly. |
| 4C.06 — retention | Real host alarm removed the abandoned inactive release/test data while preserving active and previously activated releases, saved draft and original live replies. Paused data survived cleanup; explicit deletion removed draft/release bodies and denied further viewer calls. Existing controller tests verify periodic metering/tombstone cleanup and retention of unresolved compute obligations. |
| 1G.08 — user paths | Actual editor/compiler attached the named operation, Try used separate records, and a real 2,410,916-byte PVO export worked in independent downloaded/published players after the creator page closed. Viewer calls sent neither creator cookie nor authorization. Publication storage/account identity were controlled fixtures; the service requests reached the real cloud Node path. |

### Runs and cleanup

- `run-deYEYE`: builder-only preparation failed before service execution because its new launcher did not create the status directory. Machine/app/key removed; no completed image was recorded. The failed registry-delete attempt remains recorded rather than being called verified image deletion.
- `run-dGfXoa` / Cloudflare `workspace-uefOob`: real runtime/validation/publication/data/update checks passed. Browser attachment exposed a fresh server timestamp ahead of the device clock. The client correction keeps the server’s checks unchanged and passes a browser regression with the device sixty seconds behind. Machines, app, Worker/four namespaces and scoped key removed; completed image manifest confirmed absent.
- **Final `run-LzPJJ6` / Cloudflare `workspace-Hka8QP`**: all eight check groups passed, plus a separately recorded interruption intent. App `restyle-node-proof-993458aa8d3185db81698eb8`; Worker `restyle-node-product-proof-54bffb0090feadc766dba79f`. Cleanup fenced admission, reconciled both slots to no lease, verified no remaining Machines, then removed Worker/namespaces, manifest and app. Scoped key revocation first encountered expired setup access; same-account refresh completed exact-key revocation and absence verification. `cleanupVerified` and `cloudCleanupVerified` are both true. Final app cleanup verified 19:14:59 UTC.

The one-hour organization test key is also revoked and owned plaintext credentials removed. Unrelated Lumo remains present. No production resources or integration branches changed. Registry manifest absence is verified for both completed images; provider collection of unreferenced blobs is not observable here.

### Usage, checks and beta

The final service snapshot reports **19 starts**, 375,164 ms admission-to-confirmed-destruction time, no pending cleanup and 135,168 bytes of service SQLite storage. The dated compute-only estimate is **US$0.000969** for those executions, excluding the builder and the other charges listed in the plan. This is not a provider invoice or a claim of total spend; all runs stayed within the same US$1 diagnostic plan.

Full source verification passed 1,607 tests, 927 syntax/951 dependency/652 formatting checks; strict editor types pass. The clock correction additionally passes actual browser acceptance with a sixty-second skew. Combined `59dda41` in `/private/tmp/restyle-node-final-beta-ef1deaa` passes build, types and 22 focused attachment/delivery checks. Build emitted its existing large-bundle advisory and succeeded.

Beta **`restyle-editor-shell-0aeb35ad18374509`** is served from Desktop `dist/` on 4173. Fresh served files and activated service worker are verified. Backup `~/.codex/backups/restyle-node-final-beta-1iqv5f1v` preserves previous/built output; 133 old hashed assets retained, assets copied before HTML/service worker/release notice, no forced reload. Local beta serves static assets and has no configured service/task API. Permanent cloud hosting remains undeployed; this disposable acceptance is evidence of the implemented path, not an ongoing hosted environment. Production remains explicitly deferred.

The committed tests, contract, roadmap and progress are the portable handoff. Private journals/logs are useful receipts, not a prerequisite for another agent to continue. **Next: 2A.01** in [Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md); do not rerun completed paid proofs merely because local receipts are absent.
