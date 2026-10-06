# 1D: owned services, releases and saved data

[Numbered roadmap](01-first-working-component.md#1d-run-the-finished-service-and-manage-its-data) · [Current progress](../restyle-cloud-agent-progress.md) · [Service contract](../../../packages/pvo-assistant/services/README.md)

## In plain language

The temporary computer builds the program. A separate service keeps its checked program and saved records. Each service belongs to one creator and project and has a stable identity. A release is one exact checked version of that program. New versions start inactive so testing cannot change live records or affect viewers.

The platform decides who may call each action, checks its data, runs the program without account secrets or direct network access, and saves an accepted state change atomically. Repeating an action returns its saved answer. Two people competing for the last place cannot both take it. The creator can inspect, activate, pause or delete a service. Replacing code preserves live records and the previous working release.

## Current checkpoint and ownership

All of 1C is verified. **All of 1D is verified complete.** Next is attachment in **1E.01/1E.02**. The active hosting checkout starts from current dev `4bc9f9e` and combines the verified validation prerequisite `f7dac2c` (source `98dd960`, draft #96). Checked-package hosting, owner metadata and the trusted task-host stage pass local SQLite/runtime integration and the full 1,320-test behavior suite. No new paid calls or resources.

Keep shared service/release rules in `packages/pvo-assistant/services/` and `releases/`, SQL/runtime adapters in `server/cloud-services/`, and task admission/receipts in the existing focused task modules. The owner-scoped task coordinator can retain a separate service catalog beyond task retention; generated code cannot access it. The immutable release provider must retain its own artifact bytes independently of the builder/workspace.

The 1B diagnostic single-module release has been replaced by the checked multi-module package contract, including its callers/tests/proof fixtures. Do not add a second production source format, a legacy fallback or a model-owned publication tool. Preserve the already verified uncertain-effect/cancellation journal semantics. Historical paid evidence is not permission or a reason to rerun the proof.

## First implementation slice: 1D.01/1D.02

1. Define a stable owned service identity and a release identity selected by trusted code. Bind each release to exact agreement/source/package/report digests, runtime, operations and their audience/storage permissions. Verify actual canonical bytes again before publication; only a task-owned passed report can enter hosting.
2. Save bounded owner-scoped service/release metadata and a pending publication intent before a provider effect. Exact duplicate identities replay; changed ownership/content conflicts. Source/report retention is independent of the build computer. Keep per-owner service/release counts explicit and enforced outside generated code.
3. Update the existing release provider to save the checked package inactive. Reuse its stable identity lookup, immutable contents, bounded probes, cancellation tombstone and independent expiry. Record actual provider observation and owned catalog status before advancing the task.
4. A private inactive probe receives only an allowed operation and input. The platform supplies test state and time. Generated code receives no live state, activation switch, credentials or external capabilities. Reuse the isolated package runtime and reply validation; use explicit package limits when updating fixtures: 2 MiB publication JSON, 64 KiB invocation/reply, two-second invocation deadline, 50 ms CPU and 20 private probes per inactive release. These replace the older diagnostic envelope; historical paid results retain their original recorded limits.
5. Connect the trusted `host` stage to the immutable task artifact and provider journal. Missing or failed reports cannot deploy. Recover a lost publication response by looking up the original identity; do not create another service. Stop closes pending inactive identities and blocks late attachment. Advance only to the later attachment stage, never directly to a ready component.

Before marking the two items complete, exercise actual local SQLite/provider/runtime integration, owner/project/content conflicts, failed/missing reports, byte/usage/count bounds, full restart after publication before receipt, inactive probe isolation, Stop before/after dispatch, expiry and cleanup failure. Update declarations, fixtures and documentation in the same batch. Full live cloud/model acceptance remains 1F; prepare a separate bounded plan if changed provider behavior needs new paid evidence.

## Following slices

| Tasks | Required behavior |
| --- | --- |
| 1D.03 | Stable route resolves recorded service/release, verifies owner for private operations, admits only the public operation surface for viewers and validates input before execution. Caller flags cannot select test/live permissions. |
| 1D.04/1D.05 | Separate durable test/live state. Serialize the read/execute/validated-commit operation, fence cancellation/deletion/version changes and journal action IDs. Same ID/input replays; changed input conflicts. Concurrent capacity and overlapping-booking cases use different IDs. |
| 1D.06/1D.07 | Authenticated inspection/activation/pause/delete and explicit external limits. Stop cancels inactive authoring work; active service lifetime is controlled separately. Retain cleanup obligations beyond ordinary task expiry. |
| 1D.08 | Keep the last active release while a new one is checked. A failed replacement cannot displace it. Rollback must validate current stored records against the chosen agreement; it does not rewind data. |

Do not infer production deployment from local test success or beta assets. Use the current release workflow, keep unrelated releases intact, and record implementation/PR/beta/production separately.

## Implemented slice: 1D.03–1D.05

Use one durable object per stable service identity for release storage, selected release and data. This keeps the service address independent of any release and allows data plus action receipt to commit in one SQLite transaction. Evolve the currently undeployed single-release object into that current contract; do not add a distributed directory whose registration could disagree with publication. The provider journal already records both service and release identities before effects. Preserve its original-identity lookup and cancellation behavior while changing the binding's service selection. Extract release storage without behavior changes first, then implement the new service behavior separately.

- Keep generated source/report bytes in immutable release records owned by the service object. Each record retains its own expiry/tombstone; one cancelled release cannot close another release. Trusted publication verifies service identity/owner/project before changing records. Cap releases per service as well as owner catalog limits.
- Stable routes live under `/api/services/{serviceId}`. Creator test calls require an authenticated owner and same-origin write; public calls expose only public operations after activation. Public replies contain only the validated result and action ID, never the entire stored state, source, agreement or owner identifiers. Exported-file calls require explicitly bounded public CORS; creator endpoints do not.
- Invocation input contains only `actionId`, `operation` and `input`. The route selects test/live authority; caller flags cannot. Validate operation/input before generated execution. Use separate SQL namespaces for test and live state and receipts. Never initialize live state from test state.
- Serialize read/execute/validated-commit per service with a bounded in-memory queue. Store state version and selected-release/lifecycle revision before the isolated await, and reject stale completion after deletion, pause or replacement. Pure generated execution has no external effects. On process death before commit it may rerun; after commit the matching saved action result replays. Same ID with different operation/input conflicts.
- Bound queued calls, per-day execution attempts, state bytes, receipt count and retained receipt bytes outside generated code. Exact replay cannot reapply a mutation; full receipt capacity rejects new actions instead of silently dropping deduplication records. Activation/pause/delete and active retention remain explicit 1D.06/07 work before any live route is enabled.

Required checks: full runtime restart and lost HTTP reply; two distinct IDs competing for the last place; overlapping equipment dates; matching replay/changed-input conflict; malformed input before execution; private operation rejection; test/live and owner/service isolation; stale in-flight completion after lifecycle change; bounded queue/data/receipt limits. Update the shared declarations, provider adapter, diagnostic/test fixtures and deployment bindings together. No cloud resource is created merely by adding its declaration.


### Verification and next step

The current `HostedService` class and `SERVICE_HOSTS` binding implement the single per-service ownership boundary above. No old single-release binding/schema is retained; these product declarations have not been deployed. Public HTTP and authenticated Try routes, pure authority/usage rules, serialized isolated execution and atomic SQL state/receipts are implemented. Limits and exact route contracts are documented in the [hosting package](../../../packages/pvo-assistant/hosting/README.md).

Full local checks passed 1,330 behavior tests, syntax/dependency/format gates. A final expiry-cleanup fix then passed 36 focused cases, including the new regression. Concurrent dinner/equipment requests, same-ID replay, full restart, runtime reply rejection, Stop, queue/data/receipt budgets, namespace/owner/private-operation isolation and independent release cancellation are covered by actual workerd/SQLite. Live-mode tests deliberately seed an active record through a test-only setup; no production activation API, live lifetime or live provider acceptance is claimed yet.

Next **1D.06/1D.07**: implement authenticated inspection/activation/pause/delete with exact command receipts and optimistic revisions. Make the hosted object the authority for lifecycle; keep the owner catalog synchronized without granting caller/model authority. Active and paused releases retain source/live data independently of task expiry; task Stop/abandoned cleanup may only close inactive authoring resources. Deletion removes source/data while preserving bounded tombstones and uncertainty bookkeeping. Prove restart/lost-control replies, lifecycle changes during an action, wrong owner, quotas and inactive cleanup before checking these tasks. Then implement **1D.08** safe replacement/rollback against current live state.


## Implemented creator controls and lifetime: 1D.06/1D.07

Strict owner/session/origin endpoints and the More → Cloud services panel now inspect, activate, pause/resume and delete services. The hosted object atomically records each control and lifecycle revision. Last-64 exact control replay returns the original receipt with current status; older requests fail their stale revision. The browser saves an unresolved command before sending, survives reload, and fences account changes. Activation/resume currently selects the first or existing live release; selecting a different version remains 1D.08.

Activated/paused source, records and action receipts outlive task Stop/deadline/pruning. The inactive cleanup journal recognizes `retained` without claiming deletion, while other abandoned versions still expire. Explicit deletion removes program bytes/test/live data and prevents delayed publication from reviving them. A bounded tombstone/control history remains. Owner catalog synchronization validates known identities and rejects stale host revisions; unavailable hosts never prove absence or release capacity. Quotas are still enforced in trusted code.

Verified: 1,337 full behavior tests, 702 syntax/832 dependency/371 formatting files, strict editor TypeScript, actual local HTTP/workerd/SQLite lifecycle with restart/concurrency/retention/deletion, and the real editor manager journey (lost response, page reload, exact retry, pause/resume, account switch, delete confirmation, desktop/phone). No paid provider/model call or deployed product Worker. Next: 1D.08, preserving current records and the last working program during replacement and rollback.


## Verified slice: 1D.08 safe replacement and rollback

The stable service object already retains up to four immutable checked versions. Evolve the creator activation command to choose another known version only after the current live state passes that version's data agreement and its operation interface remains compatible with existing clients. Validate before changing any source pointer, receipt or records. Preserve the previous checked bytes and all current live data/action receipts; returning to an earlier version is the same guarded command, never a restore of old data. If no live record has been written yet, preserve the current active version's initial state when replacing it. Avoid granting the model a publication or compatibility bypass.

Add pure state/operation compatibility validation, then host control integration and owned version choices in the existing panel. Test an accepted update, missing/expired/unchecked version, incompatible operation or live state, safe rollback that keeps later viewer records, rejected rollback, exact replay after restart and a version change while an action is in flight. 1D.08 is now verified by the evidence below. This slice supplies the safe host/version mechanism; later roadmap 4B connects authoring a new task to an already attached service. No new paid run is implied.


### 1D.08 verification

Live records are initialized at first activation and validated against every candidate before changing the selected version. Exact operation names/audience/access/input/result shapes remain compatible with existing clients; descriptions and ordering can change. Source/report identity remains immutable, previous code is retained, and rollback keeps current records/action receipts. The same revision/receipt command powers the manager's known-version buttons. Unsafe state/interface changes, missing and expired versions return an honest failure without changing the working service.

All **1,343** repository tests pass, along with **705 syntax**, **833 dependency**, **374 formatting** files and strict editor TypeScript. Six update cases include valid update/rollback, rejected interface/state change, original-state preservation before any viewer call, exact replay after restart, an in-flight execution fence, and expiry. The actual editor browser journey chooses versions and returns without losing a viewer record. Controlled checked publications isolate host mechanisms; later 4B owns authoring a new task against an existing service. No paid cloud/model call, remote CI polling or production change. Next: 1E.01/1E.02.
