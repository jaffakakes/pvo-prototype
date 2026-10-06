# 1G: Containers — one service system, with editable Node.js code

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md#containers-the-next-product-feature) · [Current evidence](../restyle-cloud-agent-progress.md)

**Status: planned, 6 October 2026. All work here is unchecked.** Containers follows 1F and comes before Roadmap 2. The inspected implementation still has partial 1E and unfinished 1F; the user confirmed that their recorded status must be preserved. This document adds no implementation or deployment claim.

## The simple version

A **Component** is what viewers see and press. A **Container** is the saved, hosted Node.js service behind it. The **workshop** is the temporary computer the AI uses to develop that service.

Think of the **VM as the workshop**, the **Container as the finished service**, **storage as the filing cabinet**, and the **Component as the front desk**. The workshop builds and repairs; the service handles visitors; the filing cabinet keeps the information when either computer stops. Technically, the workshop itself can run in a provider container: these names distinguish their jobs and lifetimes.

Creators open **Containers** outside the Components area. They can inspect the AI's JavaScript, edit it themselves, ask the AI to continue from those edits, test the saved draft, and publish a checked version. A component selects an approved operation from that Container. Restyle supplies the connection; the creator does not arrange hosting or paste a server URL.

The Container has a lasting identity even when its running instance stops. Its code, published versions and records live in Restyle's durable storage. Restyle can start another instance from the same saved release when needed. An idle instance stopping is different from the creator pausing the service.

## Consolidation: what we reuse and what changes

**Container is the product name for the existing owned service.** Keep its `serviceId`, owner, project scope, data, releases and management commands. Add the missing draft/editor capabilities and replace its generated-code execution adapter. Do not create a second Container registry, database authority, task runner, deployment pipeline or component protocol.

| Existing foundation, inspected at `25321a7` | Container work |
| --- | --- |
| [Service host](../../../server/cloud-services/host.js) and [release storage](../../../server/cloud-services/releaseStore.js) own immutable versions and lifecycle. | Extend this same service with a saved editable draft; keep published releases immutable. |
| [Invocation](../../../server/cloud-services/invocation.js) validates calls, serializes state changes and commits data plus action receipts together. | Keep these rules outside Node.js code. Replace the execution effect underneath them. |
| [Dynamic Worker adapter](../../../server/cloud-services/packageExecution.js) loads source into a fresh Worker with no secrets or outbound requests. | Replace this generated-service runtime with isolated hosted Node.js Containers. A rename or Node tests in the workshop is insufficient. |
| [Package contract](../../../packages/pvo-assistant/services/package.js) requires `cloudflare-workers-esm` and an empty dependency lock. | Define one Node.js package contract, pinned runtime and reproducible dependency bundle. Replace old runtime assumptions in source, fixtures and documentation together. |
| [Independent validation](../../../server/assistant/validation/cases.js) checks behavior in Dynamic Workers. | Run the independent checks against the exact Node.js artifact and runtime that will be published. Keep expected answers and pass/fail authority outside generated code. |
| [Workspace](../../../server/assistant/workspaces/coordinator.js) saves task source and restores a temporary computer. | Restore from a revision of the service draft; write accepted AI changes back through the same draft command as manual edits. Workspace files remain a working copy. |
| [Service manager](../../../editor/src/features/services/ServicesPanel.tsx) already lists owned services and offers version selection, pause/resume and delete. | Evolve that feature into the Containers destination with Code, Tests, Versions, Connections and Usage views. These are views of one service. |
| [Attachment contract](../../../packages/pvo-assistant/attachments/README.md) checks ownership, public operations, typed inputs and retry identities. | Reuse it for selecting an existing published Container as well as AI-created components. Complete 1E/1F before claiming the whole viewer path. |

Current hosting code already preserves activated source and live records independently of task cleanup. Its local tests establish those guarantees for Dynamic Workers. The earlier real cloud proofs establish workshop/hosting separation and provider recovery, **not hosted Node.js service acceptance**. Product Worker deployment is not recorded as complete.

## One draft, one publishing path

1. **Open or create a Container.** Use the existing owner catalog and project identity. It can exist before any component. The first version retains the current same-owner, same-project attachment rule; listing it outside Components does not grant access from other projects or accounts.
2. **Edit the saved draft.** Manual and AI edits both send the expected draft revision. Restyle saves a new revision only if it still matches. Concurrent changes produce a recoverable conflict; neither editor overwrites newer work silently. Pending local edits survive a failed save and are shown as unsaved.
3. **Ask the AI to continue.** The existing saved-task runner receives the Container identity, draft revision and request. It opens a disposable workshop from that revision, keeps questions/progress, and proposes changes to the same draft. Stopping the build leaves the draft and current published service intact.
4. **Test an exact revision.** Save before testing. Restyle freezes the code, behavior agreement, dependencies and runtime identity for independent checks. Creator/AI tests are useful feedback; neither can write its own trusted passing report. Changing any tested input invalidates readiness for the changed draft.
5. **Publish that checked version.** The existing deployment journal prepares an inactive release, verifies its hosted Node.js behavior, and switches the selected live version through the existing activation command. Saving or testing alone does not change live behavior. A newer draft can coexist with an older published version.
6. **Connect a component.** Pick the Container and an allowed operation, map fields, and apply through the current compiler/history boundary. The export/publication workflow confirms the selected service is active before delivering a usable file or link. The creator sees names and operations, not provider URLs.

Manual edits and AI edits receive exactly the same validation, permission, test and publication rules. Editing test expectations is an explicit change to the behavior agreement and requires a fresh check; the AI cannot weaken the platform's independent isolation, input, retry and ownership checks.

## Runtime and storage design

```mermaid
flowchart LR
  Human[Manual editor] --> Draft[Saved service draft]
  AI[Existing saved AI task] --> Draft
  Draft --> Workshop[Temporary workshop]
  Workshop --> Draft
  Draft --> Check[Independent Node.js tests]
  Check --> Release[Immutable checked release]
  Release --> Host[Existing service host and gateway]
  Viewer[PVO component] --> Host
  Host --> Node[Disposable Node.js instance]
  Node --> Host
  Host <--> Data[Durable records and action receipts]
```

Use the existing per-service host as the authority for draft revisions, release selection, test/live namespaces, request limits and atomic records. Keep small metadata in its durable storage; if locked dependencies exceed the present source-package bounds, store immutable content-addressed bundles in private object storage with owned references. Choose and verify bounds before enabling larger packages. Object storage is an artifact store, not a second service registry or an independent transaction authority.

Proposed first runtime: a platform-managed, pinned Node.js base image plus the checked immutable service bundle. Restyle restores verified bytes before starting the private service listener. Dependencies are resolved and integrity-checked during the isolated build; no package installation on a viewer request. Any package installation scripts require an explicit supported build policy. Creators do not supply Docker infrastructure or platform deployment credentials. A bounded provider proof must confirm that this loading approach works before committing to its adapter.

Keep the named operation agreement and `execute({operation, input, state, now})` boundary. Node.js code can use supported JavaScript libraries and temporary files, but durable changes go through Restyle's validated result/state commit. The gateway exposes approved operations; arbitrary process ports or file paths are not public APIs. PVO Logic stays its separate restricted language and continues to call the checked request boundary.

The trusted host remains outside the guest. Node.js `vm`, a child process, or a passing test is not a security boundary. Isolate different services, validation runs and test/live execution in provider sandboxes; never mix another owner's source or live records into a shared guest. Treat everything returned by the guest as untrusted. Keep durable database handles, platform credentials, test expectations and deployment authority outside it. Enforce network denial and termination from the host/provider, including spawned descendants; resetting process state must not leave hidden writable files or background processes affecting later invocations.

The platform Worker still owns routing and durable coordination; replacing Dynamic Worker execution does not require moving Restyle itself into Node.js. Before replacing the development runtime contract, inventory any existing development releases and preserve their source/evidence; retiring live resources or transforming stored records needs an explicit scoped decision. Do not silently discard records or add a legacy reader.

The hosting adapter may need a private execution controller to provide those isolated instances. That controller owns only compute start/ready/stop and resource accounting. It has no second copy of service ownership, live data or publication state. Verify its exact instance mapping and concurrency strategy in 1G.04.

Retain separate test and live data. Node.js receives only the admitted call and its namespace's state. Validate its response and recheck release/lifecycle/state revision before committing state and the action receipt atomically. Lost responses retry the saved action ID and input. A crash before commit may rerun computation; a crash after commit replays the stored result. External side effects require Roadmaps 2/3's separate receipts and reconciliation before they can be enabled.

Source, release bundle, reports, selected version, records and receipts must survive both workshop deletion and live-instance destruction. Memory, local disk and shutdown callbacks cannot be their only copy. A sleeping instance can restart automatically; a paused or deleted service cannot. Cold starts have a deadline and a truthful retryable outcome, with the original action identity retained.

Cloudflare remains the first provider candidate. Its [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/) documents temporary disks and a distinct ready state; its [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/) provides host-controlled start, networking and stop operations. These are provider capabilities, not evidence that Restyle's proposed adapter has passed. Recheck them in the implementation proof.

## Updates, controls and costs use existing foundations

**Version updates:** the current activation command already checks operation compatibility and current stored records. Build a new inactive release, keep the working release serving, then switch only after checks. Existing component connections follow the stable service's compatible live version; record which release was checked when attaching. Retrying an old completed action returns its original result. Returning to prior code keeps today's data. Reject incompatible operation/data changes with an explanation; do not add automatic data migrations or compatibility runtimes.

**Pause/resume:** reuse the existing lifecycle command and replay receipt. Pause blocks new live calls and fences in-flight commits, then stops unnecessary compute. Retain code and data. Resume starts the retained checked release, subject to current capacity and spending permission. Stopping an AI task has no authority to pause a live service.

**Delete/cleanup:** reuse explicit service deletion, warn about connected components and exported copies, fence new work first, then remove draft, releases, records and owned compute/artifacts. Save cleanup obligations outside any guest until absence is verified; an unavailable provider is not proof of deletion. Retain only bounded tombstones needed to prevent late resurrection. Sweep abandoned builds/tests/releases without deleting active or paused data. Removing a component or pressing Undo does not delete the Container.

**Limits/costs:** extend existing admission and usage accounting for instance size, CPU/runtime, idle lifetime, startup time, concurrency, starts, build/package download bytes, stored bundles/data/receipts and logs. Bound test and live usage separately, plus service/owner/platform totals. Reserve capacity before work, meter outside the guest, reconcile uncertain starts and stop owned processes at the limit. Do not reintroduce an arbitrary total model-turn or goal-age ceiling: save progress and wait for capacity or actual spending permission.

Show build/test usage separately from ongoing hosting/storage, with a dated estimate and known uncertainty. Sleeping compute can stop consuming runtime while retained storage still has costs. Include Worker/Durable Object, storage, logs and network charges in estimates; provider billing is not an instantaneous application spending cap. Consult current [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/) before a paid proof. Previous US$1/US$15 batches are closed; this documentation authorizes no new spend.

## Ordered implementation checklist

There are **eight new tasks**. Twelve existing unchecked update/management tasks move here from Roadmap 4 with their original IDs and wording. They are listed once, below; do not implement them again in a second management system. All existing completed task IDs and evidence remain unchanged.

### A. Settle the shared contract and saved editing

- [ ] **1G.01** Confirm the 1E/1F prerequisites and define the single service/draft/release contract for Containers: existing owner/project/service identity, draft revisions, Node.js artifact identity, operation agreement, retention and current permissions. Record exact changed contracts and the minimum provider proof before app work.
- [ ] **1G.02** Add durable draft read/save operations to the existing service boundary and evolve the service manager into Containers outside Components. Support code inspection/manual edits, recoverable pending saves, revision conflicts, reload and account changes; keep current live code unchanged.
- [ ] **1G.03** Let the existing saved AI task continue editing that same draft through the same revision-checked command. Restore a disposable workshop, preserve manual changes/questions, recover after restart and Stop safely without duplicating the service.

### B. Replace execution and preserve the trusted gates

- [ ] **1G.04** Implement and prove the bounded hosted Node.js execution adapter and reproducible package: pinned base/runtime, checked dependency bytes, isolated test/live instances, private listener, readiness, cold restart, externally enforced limits, network policy and process cleanup. Record a concrete cost/resource/cleanup plan before any paid proof. Keep Dynamic Worker evidence; remove its superseded generated-service runtime contract when the Node replacement lands, without a dual-runtime fallback.
- [ ] **1G.05** Run independent platform validation against the exact Node.js artifact used for hosting. Apply the same gates to AI/manual edits; invalidate stale reports after source/agreement/dependency/runtime changes. Check malformed replies, ownership, isolation, time/output limits and test/live separation; generated tests or claimed success cannot grant readiness.
- [ ] **1G.06** Connect the Node adapter to the existing deployment journal and per-service host. Persist release intent before effects, recover lost replies, verify inactive readiness, preserve data/action receipts through instance destruction, and clean up abandoned resources without changing the current live release.

### C. Publish, connect and update through existing commands

- [ ] **4B.01** Build a new inactive release from retained source and the requested change.
- [ ] **4B.02** Identify every recorded active component connection and export that points to the service. Forwarded or downloaded copies may still use those addresses even when Restyle cannot count the viewers. Test the update against the recorded agreements.
- [ ] **4B.03** Check that the new code can use the current saved records. Define a specific data-change task if that cannot be guaranteed; do not silently rewrite or discard records.
- [ ] **4B.04** Keep the active release unchanged while tests run.
- [ ] **4B.05** Switch only the verified service/component connection as one recorded release action. Preserve the prior release for recovery while it remains safe to run against current records.
- [ ] **4B.06** Test a failed update and restore service availability without replaying external writes.
- [ ] **4B.07** Explain what editor Undo can restore and which live changes require a separate reversal.

- [ ] **1G.07** Let a component select a checked operation on an owned published Container using the existing attachment command, typed field mapping, compiler/history and approved-host policy. Reuse activation checks for download/publication, server-authorized Try and public player action replay. No manual server URL or creator administration data enters the PVO.

### D. Finish the same management surface

- [ ] **4C.01** Show which projects and published components use each service and which account connections they need.
- [ ] **4C.02** Add useful views of remaining quotas, approximate cost, recent results, and failures.
- [ ] **4C.04** Let creators inspect retained data and choose the allowed cleanup action.
- [ ] **4C.05** Explain the effects of pause and deletion on new submissions, accepted jobs, and stored records before applying the selected operation.
- [ ] **4C.06** Verify periodic cleanup removes only abandoned resources and expired records covered by the agreed retention rule.

These transferred tasks cover the basic Container service in 1G. Account connections and durable viewer jobs remain unavailable until Roadmaps 2/3 implement them; those later milestones extend the same controls and rerun their affected acceptance, rather than creating another management feature. Forwarded downloads cannot be fully enumerated, so the UI must say when impact counts are incomplete.

### E. Verify the complete feature

- [ ] **1G.08** Verify the acceptance matrix below with real editor/player tests and bounded provider evidence for the hosted Node.js path. Record costs and cleanup, complete relevant source/type/build checks, deliver the beta without forced reload, and follow separately authorized production promotion. Update the progress/handoff after each verified task; a plan, local fixture or static beta alone cannot finish this gate.

| Acceptance | Evidence required |
| --- | --- |
| One saved draft | Manual edit → AI continuation → conflict/reload recovery; both preserve the same Container identity and newer edits. |
| Same gates for every author | Deliberately invalid manual and AI versions both fail; editing tested bytes cannot publish with an old passing report. |
| Real hosted Node.js | Approved Node.js code and a locked supported library run in the published environment after workshop deletion and live-instance destruction; code, records and receipts survive. |
| Component connection | Select an operation without a URL; Try changes only test data; downloaded PVO on a supported separate origin and published player use live records without a creator cookie. |
| Updates and uncertain results | Good update and safe rollback retain current data; failed/incompatible update leaves live service working; duplicate submissions and lost deployment/control replies recover one original operation. |
| Ownership and lifecycle | Wrong owner denied; account change hides private source; idle restart works; paused/deleted services cannot restart for viewers; limits and resource cleanup survive host restart. |

**Definition of done:** all eight new tasks and twelve transferred tasks are verified. Creators can build, inspect, edit, test, publish, connect, update and manage one saved Node.js service while Restyle owns hosting. Implementation, beta availability and production deployment remain separately recorded.

## Scope and implementation homes

Use `packages/pvo-assistant/{services,releases,hosting,attachments}` for shared contracts; `server/cloud-services/` for authoritative drafts/releases/data/lifecycle and execution adapters; existing assistant task/workspace/validation owners for AI work; `editor/src/features/services/` and its domain/infrastructure counterparts for Containers. The player consumes public package/HTTP contracts. Keep rules separate from UI and effects, and update static package copying/types/schema only where the actual contract changes require it.

This milestone includes JavaScript/Node.js only. PVO Logic remains restricted. Plugins, a marketplace, sharing Containers with other creators and installer-specific credentials are outside this update. External account integrations and long-running viewer jobs keep their existing Roadmap 2/3 owners. Other languages and runtimes stay future capability work.

Next after Containers: [Roadmap 2 — research and connections](02-research-and-connections.md). [Roadmap 4](04-maintenance-and-expansion.md) retains diagnosis, connection-health/operational monitoring and further expansion; it reuses this service system.
