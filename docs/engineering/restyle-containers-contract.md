# Containers: implementation contract and acceptance plan

[Numbered work](restyle-cloud-agent-roadmaps/1g-containers.md) · [Progress](restyle-cloud-agent-progress.md) · [Existing hosting](../../server/cloud-services/host.js)

## Decision recorded for 1G.01 — 7 October 2026

1E and 1F passed through beta at `e17bbdb`, with beta `restyle-editor-shell-e069ede11e8ff6b7`. Their evidence remains in [first-release acceptance](restyle-first-release-acceptance.md). Production stays unchanged until the remaining work and user beta testing are complete and the user approves release. This document defines the implementation target; it does not claim the Node.js provider proof has passed.

New work starts on `feature/restyle-containers`, from fetched `origin/dev` (`cc2193e`) with the verified, unmerged first-release prerequisite `e17bbdb` explicitly merged. No integration or production merge is implied. The existing Dynamic Worker proof remains historical evidence. Its ten diagnostic deployments and secrets are already removed. Inventory any newly discovered development release before retiring its runtime; never erase live records to make a test pass.

## In everyday terms

The **workshop** is a temporary development computer. A **Container** is the saved server service people use afterward. Its **draft** is the editable code; a **release** is a frozen, tested copy. The **Component** is the visible form or button. Stopping either computer must not erase saved code or submissions.

## One identity and one source of truth

- Keep `serviceId`, `ownerId` and `projectId`; the same per-service Durable Object owns its draft, releases, selection, records and receipts. The existing account catalog remains an index and admission authority, never a second source store.
- Add authenticated create/read/save draft operations to `/api/services`. Creation requires an owned server project and an idempotent creator action. Allocate the service identity deterministically from owner, project and creation action before remote effects. Reserve catalog capacity first; interrupted initialization is retried for that same identity.
- A draft contains `revision`, ownership, a description, source/test files, entry point, selected test paths, the behavior agreement (nullable while incomplete), dependency lock and update time. A bounded incomplete program can be saved. Saving is not approval to execute or publish it.
- Both manual edits and accepted AI changes use `{actionId, expectedRevision, content}` at the same authoritative save boundary. Exact replay returns its saved receipt; reusing an ID with different content conflicts. A stale revision returns conflict without replacing either side. Explicitly review/reapply a local draft against the newer server revision.
- Store bounded receipts with their committed revision. Once an old receipt is evicted, its old expected revision prevents replaying the mutation. Revision counters have no arbitrary lifetime edit cap.
- First generated publication initializes the saved draft from its exact owned source and agreement. Later publication must not overwrite newer manual edits. A draft may exist without a release or Component. Opening a draft never creates a task or starts compute.
- Browser pending state is scoped by owner and service, stored before sending, retried with identical bytes/ID, and retained after uncertain replies or reload. Account changes abort requests and immediately hide private code. Local storage failure is visible; never describe an unsaved edit as saved.

## Tested artifact and Node.js contract

The source implementation now replaces `cloudflare-workers-esm` with one `nodejs-esm` package contract. Update package declarations, planner/tool schemas, source, tests, fixtures and current documentation together; no fallback reader or second runtime. Keep the named `execute({operation,input,state,now})` boundary and current bounded schemas.

The package digest covers source/test files, agreement digest, exact runtime identity, entry point and locked dependency identities/bytes. The runtime identity records a digest-pinned base image, exact Node version and platform runner version. Resolve these immutable values in the bounded proof before enabling the adapter. Reject a runtime mismatch instead of silently running another version.

Initially support a small platform-curated set of pure JavaScript libraries with exact versions and integrity-checked, retained bundle bytes. No arbitrary package URL, install script, native addon or dependency installation during a viewer call. Unsupported dependencies produce an explicit error. Retain the current one MiB package bound; expanding it requires an explicit new storage/admission design. Preserve license notices with bundled libraries.

The independent validator runs the same immutable artifact and runtime as hosting. Trusted expected results stay outside the guest. Reports bind to the full artifact digest and policy; changing code, agreement, lock or runtime invalidates readiness. Creator tests, AI claims and browser syntax checks never grant a passing report. Test/publish commands preserve exact revision and intent through restart; a newer draft cannot inherit an older passing result.

## Compute isolation and lifetime

Keep ownership, admission, state transactions, public routes and publication journals in their current owners. The new execution controller only owns private compute, deadlines, cleanup obligations and measured usage.

Use a fresh provider sandbox for each admitted invocation (including every independent test step), destroyed after the bounded reply. This deliberately trades cold-start cost for a clear initial isolation guarantee: memory, files and descendants cannot influence a later request. Reuse a bounded controller slot only after provider-confirmed destruction; never reuse a dirty guest. Test, live and validation inputs have distinct scope identities. Keep concurrency bounded and return a truthful retryable capacity outcome while preserving the action ID.

No guest receives platform secrets, database handles, expected tests or deployment authority. Disable guest network access at the provider; enforce startup, execution, output and destruction limits from outside the guest. Node `vm`, OS user IDs and child process termination are not the security boundary. The private listener exposes only the admitted operation and receives the exact checked bytes before running code; no guest port becomes a public route.

Persist a cleanup obligation and reservation before starting an instance. An alarm reconciles interrupted starts and destroys overdue compute. A missing reply or failed inspect is uncertainty, not verified absence. Store draft, releases and records outside the guest. Pause fences new calls and in-flight commits; deletion fences resurrection and keeps cleanup tombstones until owned resources are gone. Component removal and editor Undo do not delete a service or reverse viewer records.

## Device versus cloud: observable selection rules

| Action | Execution choice | Required observation |
| --- | --- | --- |
| Open/list code, edit/save, inspect agreement, local parse/field validation, preview Component | Device plus existing authenticated storage | Zero workshop starts; no paid-execution reservation |
| Read a draft, ask/answer a question, save an AI file patch | Existing saved task plus model when authorized | Zero workshop starts; model cost separately accounted |
| Run generated Node tests or a supported development command | Existing temporary workspace from exact saved revision | Recorded execution reason and reservation before start; files saved before cleanup |
| Independently check publication | Restyle-controlled isolated Node execution | Exact artifact report; metered separately from development workshop |
| Viewer calls | Private hosted execution plus existing durable state authority | Creator may be offline; exact retries replay committed results |

Browser suspension cannot count as completed local tests or authorize new cloud spend. Existing authorized server tasks continue from saved state. Stopping an AI task keeps the draft and published service. Model calls keep the goal-based continuation rules; no arbitrary total model-turn or task-age cap is reintroduced.

## Retention, permissions and updates

Keep same-owner/same-project attachment, public versus creator operation audiences, read/write permissions, and separate test/live data. External accounts, secrets, messaging and durable jobs remain unavailable until Roadmaps 2/3. Do not create plugin installation credentials or sharing between creators.

Drafts survive task expiry and idle-instance destruction until explicit service deletion. Retain the latest draft plus bounded mutation receipts, not unbounded full-source history. Published releases and live data keep the existing limits; inactive abandoned release cleanup must not delete a saved draft. Test records can be explicitly reset without changing live records; clearing live records needs an explicit supported operation with a visible impact statement, not a generic SQL editor.

Update through the existing inactive publication and activation journal. The current release stays live during editing/tests. Activation checks all recorded connection agreements and the current live state, switches one service revision, and retains prior safe releases. Rollback changes code while preserving today's data and action receipts. Incompatible updates fail without rewriting data. Lists of connections must disclose that forwarded files cannot all be counted.

## Selected provider and retained responsibilities

The user selected **Fly.io on 7 October 2026**. Use a private Fly Machines execution effect, subject to [its runtime/isolation/cleanup proof](restyle-node-provider-proof.md). Keep drafts, releases, live/test records, ownership, task continuation and attachments in their existing Restyle authorities. Fly receives only admitted execution input and the exact checked artifact; its credential stays in the trusted adapter. Replace the prepared Cloudflare-specific execution effect when verified, without a dual-runtime fallback or a second service manager. The Cloudflare facts and estimates below document the original preparation; they are not Fly pricing or proof. The source now routes independent validation, inactive probes and hosted live/test calls through this one Node contract. Beta `restyle-editor-shell-0aeb35ad18374509` contains this Node contract. [Integrated Fly acceptance](restyle-node-product-acceptance.md#verified-result--7-october-2026) and cleanup pass; static beta delivery does not configure a service/task API.

## Minimum provider proof before enabling Node.js hosting

The [runnable Node proof and cleanup plan](restyle-node-provider-proof.md) records the current preparation and authorization state.

Prepare a dedicated diagnostic Worker/application with no production routes or binding changes. Use fixed reviewed source initially, then the real editor path in 1G.08. Record resource names, limits, permission and expiry before creation; retain the journal and verify removal afterward.

Required evidence: immutable image/runtime match; a supported locked library executes without package-network access; private readiness and bounded output; network denied; infinite loop and spawned descendant stopped by whole-instance destruction; fresh request cannot see an earlier file; exact bytes restored after destruction; records/replay survive while workshop is absent; wrong owner and test/live isolation; pause/delete prevent viewer restart; lost start/deploy/control replies reconcile without duplicate committed effects; all owned resources absent after cleanup.

First diagnostic proposal: one Worker, one execution application with at most two `lite` instances, bounded Durable Object namespaces, no persistent external volume, no model calls, maximum 60 minutes from creation, at most 100 admitted starts with a 60-second lease each. At the 7 October rates, 120 instance-minutes at full provisioned lite CPU/memory/disk is approximately US$0.01451 before Worker, Durable Object, storage, network and logs. Reserve US$1 as an operational estimate for this proof, not an invoice or a new goal-wide limit. Obtain scoped test-spend authorization after the runnable plan and cleanup driver are ready; earlier 1F spending does not silently fund this new proof. Further end-to-end tests need their concrete plan recorded before creation.

Provider facts checked against the [Container API](https://developers.cloudflare.com/containers/api/durable-object-container/), [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/) and [pricing](https://developers.cloudflare.com/containers/platform/pricing/). Cloudflare documents separate running/readiness states, outside-guest start/network/destroy controls and metered running resources. These documented capabilities are not proof that this adapter works. Runtime/image resolution, provider execution and cleanup remain unchecked 1G.04/08 work.

## Verification and continuation

1G.01 is a contract/documentation task: review this contract against actual service, release, task/workspace, validation and attachment owners; verify links and retain the recorded 1E/1F evidence. The later 1G.02–03 checkpoints verify saved drafts and manual/AI editing through beta. Next is 1G.04 hosted Node.js execution and provider acceptance. Keep every unverified implementation checkbox unchecked. Finish Roadmap 1 through beta only; user beta acceptance and production are separate later gates.


## Records and cleanup checkpoint (7 October 2026)

The existing host now serves a bounded owner-only records snapshot and daily operation/reply usage, with live data and each available release’s test data separated. Five recent saved results and eight safe failure codes are shown per area. Reads do not execute the program. Failure history retains only those eight entries until test-release cleanup or service deletion; input bodies and generated exceptions are never logged. See the [hosting contract](../../packages/pvo-assistant/hosting/README.md#private-records-and-allowed-cleanup).

`reset_test` extends the existing revision-fenced control command, with an exact release ID and the same persistent retry receipt as pause/delete/activate. It restores only that release’s starting test records, retains usage and successful action identities, and fences unfinished commits. It cannot clear live records, remove replay protection or reactivate a paused Container. The UI confirms resets, pause and deletion and explains which effects editor Undo cannot reverse. Remaining cost/connection views and Node provider acceptance still have their own unchecked gates.


## Existing published operation connection — verified through beta

Creators select a component, its unused control and a published public operation from Containers. Typed form-field or fixed-value mapping goes through the existing checked attachment command, real PVO compiler, approved-host rules and one Undo transaction. The server rechecks same owner/original project and the exact current retained release. Project-only account associations support this without an AI task, model call or workshop. Copies drop the private association.

Actual browser acceptance covers saved reload, Undo/Redo, owner-authorized Try with separate records and interrupted action replay, normal download/publication and cookie-free viewers on another origin. A newer test draft does not retarget an already attached retained version. No manual host URL or creator administration data enters the PVO. Recorded connection/export impact remains separate 4B.02/4C.01 work; Node execution acceptance remains unchecked.


## Recorded uses and checked updates

The existing per-service store now keeps a private dependency index beside releases. The editor reports locally saved project connections; a failed report shows a retry while preserving the previous list. Export readiness records the immutable dependency snapshot before file/link delivery. Ready owned PVO links are associated with that export. Containers shows named projects, component/operation identifiers, prepared exports and recorded publication links, with an explicit warning that forwarded/downloaded viewers cannot all be counted. This is dependency metadata, not a second service registry or source store.

Every activation checks recorded retained agreements and today’s live records in the same transaction as release selection/control replay. An incompatible update leaves the current version and data untouched. The prior code remains available for a compatible rollback; original viewer action IDs keep their original replies. External writes/jobs are not enabled yet, so this milestone proves Restyle record/reply preservation; Roadmaps 2/3 must extend the same protection to external effects.

**Separate data-change task when compatibility fails:** identify the current service/release and record schema, the desired schema, the exact transformation for every existing record (including missing/invalid values), which connected inputs/results change, how to preserve action identities, and an independently checked recovery plan using the records present at execution time. Preserve the current service until that plan is explicitly reviewed and implemented. This milestone does not execute a conversion, silently reset records, add migrations or bypass the checked contract. The failure message points to this separate task.

Update verification maps to 4B.01–06: same saved manual/AI draft builds an inactive candidate; active code remains available during failed/generated/independent tests; exact activation replies recover through restart; operation/state incompatibility leaves live records intact; compatible earlier code can be selected without replaying accepted writes. The underlying Node runtime replacement remains a separate unchecked gate even when these runtime-independent update controls pass.


## Node usage and library controls — 7 October 2026

Manual library selection edits the existing saved draft. AI decisions select the same exact supported IDs, resolved by the platform to retained bytes; neither author can use a prior report after changing the selected package. The browser never installs packages or starts compute for selection/saving.

The private records snapshot now includes actual service SQLite bytes and an aggregate of the two private execution-slot counters. The service host authorizes the owner before reading those counters and rechecks deletion afterward. Live, test, independent validation and readiness remain separate. Daily capacity is shared across the owner's services and across the platform, with an explicit reset time; this is not a lifetime goal/model-turn limit. Unfinished execution/cleanup remains a separate obligation and estimate. Missing or inconsistent accounting is shown as unavailable, not free usage.

The UI uses the dated [Fly compute basis](restyle-node-provider-proof.md#product-resource-deadlines-and-fly-estimate--7-october-2026). This measures admission through confirmed destruction and can exceed billed running time. AI/workshops, image builds/registry, stopped root filesystems, Worker/Durable Object requests/duration/storage, network/logs, subscriptions and tax are excluded; allowances are not deducted. Measured SQLite bytes include source, releases, data, receipts and database overhead, but exclude shared task/compute stores and do not measure GB-months. The view is a useful estimate with explicit gaps, not a total bill. Private accounting expires under the existing thirty-day retention rule; a still-owned cleanup obligation is retained until settled. No new data or execution authority is introduced.


## Hosting configuration and beta availability

The platform operator supplies these private settings for an explicitly authorized hosting environment; creators choose named operations in Restyle and never paste provider URLs:

| Setting | Required value |
| --- | --- |
| `SERVICE_NODE_EXECUTION` | Existing `ServiceNodeExecution` Durable Object binding, already declared in Wrangler. It owns two durable compute slots. |
| `SERVICE_NODE_FLY_APP` | The dedicated Fly app owned by the platform in the authorized account. Keep it separate from unrelated apps. |
| `SERVICE_NODE_FLY_IMAGE` | `registry.fly.io/<that-app>@<the exact SERVICE_RUNTIME.imageDigest>`. Reproduce the pinned runtime and retain the immutable image. |
| `SERVICE_NODE_FLY_TOKEN` | Private app-scoped deploy credential in Worker secrets. It reaches only the fixed Machines API; never a generated execution guest, browser or PVO file. |

The current profile uses Fly `iad`, shared-1x and 1 GiB. Every invocation starts fresh private compute and destroys it before returning a successful result; source, records and action receipts stay in the existing service host. Missing configuration fails closed before reserving compute. Preserve image access and valid scoped credentials while the environment is enabled; preserve durable cleanup leases until all owned Machines are confirmed absent before decommissioning it.

The isolated acceptance configures these values temporarily, verifies the complete path, then removes its resources. The local beta on port 4173 serves the app assets and update notification flow; its static server does not supply service/task APIs. A permanent beta/cloud backend requires a separately configured hosting environment and ongoing resources. Neither static asset delivery nor a passing disposable proof is a production deployment. Production remains explicitly deferred.
