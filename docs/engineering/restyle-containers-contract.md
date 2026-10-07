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

Replace `cloudflare-workers-esm` with one `nodejs-esm` package contract when the Node adapter lands. Update package declarations, planner/tool schemas, source, tests, fixtures and current documentation together; no fallback reader or second runtime. Keep the named `execute({operation,input,state,now})` boundary and current bounded schemas.

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

## Minimum provider proof before enabling Node.js hosting

Prepare a dedicated diagnostic Worker/application with no production routes or binding changes. Use fixed reviewed source initially, then the real editor path in 1G.08. Record resource names, limits, permission and expiry before creation; retain the journal and verify removal afterward.

Required evidence: immutable image/runtime match; a supported locked library executes without package-network access; private readiness and bounded output; network denied; infinite loop and spawned descendant stopped by whole-instance destruction; fresh request cannot see an earlier file; exact bytes restored after destruction; records/replay survive while workshop is absent; wrong owner and test/live isolation; pause/delete prevent viewer restart; lost start/deploy/control replies reconcile without duplicate committed effects; all owned resources absent after cleanup.

First diagnostic proposal: one Worker, one execution application with at most two `lite` instances, bounded Durable Object namespaces, no persistent external volume, no model calls, maximum 60 minutes from creation, at most 100 admitted starts with a 60-second lease each. At the 7 October rates, 120 instance-minutes at full provisioned lite CPU/memory/disk is approximately US$0.01451 before Worker, Durable Object, storage, network and logs. Reserve US$1 as an operational estimate for this proof, not an invoice or a new goal-wide limit. Obtain scoped test-spend authorization after the runnable plan and cleanup driver are ready; earlier 1F spending does not silently fund this new proof. Further end-to-end tests need their concrete plan recorded before creation.

Provider facts checked against the [Container API](https://developers.cloudflare.com/containers/api/durable-object-container/), [lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/) and [pricing](https://developers.cloudflare.com/containers/platform/pricing/). Cloudflare documents separate running/readiness states, outside-guest start/network/destroy controls and metered running resources. These documented capabilities are not proof that this adapter works. Runtime/image resolution, provider execution and cleanup remain unchecked 1G.04/08 work.

## Verification and continuation

1G.01 is a contract/documentation task: review this contract against actual service, release, task/workspace, validation and attachment owners; verify links and retain the recorded 1E/1F evidence. Next, implement 1G.02 saved drafts and the Containers editor using the existing service manager. Keep every unverified implementation checkbox unchecked. Finish Roadmap 1 through beta only; user beta acceptance and production are separate later gates.
