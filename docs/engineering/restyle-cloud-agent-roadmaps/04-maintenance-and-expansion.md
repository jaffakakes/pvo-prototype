# Roadmap 4: maintain and expand what was built

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md)
Task IDs are stable. Checked items are verified work; update their evidence and the [handoff progress log](../restyle-cloud-agent-progress.md) whenever a task finishes.


**Outcome:** a creator can ask Restyle to change or fix an existing connected component. The agent understands what is already deployed and can make a tested update.

[Current maintenance contract and verification](../restyle-maintenance.md)

**Depends on:** Roadmap 1 and [1G Containers](1g-containers.md), including saved source, Node.js releases, service controls and basic recovery. Roadmaps 2 and 3 are needed for any connected accounts or background jobs affected by an update.

Core ownership, limits and lifecycle already exist in 1D; 1G extends them for editable Node.js Containers. Basic update/management work is scheduled once in 1G. This roadmap adds diagnosis and the later operational capabilities below.

## 4A. Let the agent inspect and repair an existing feature

- [x] **4A.01** Give it a scoped view of the deployed source, component connection, release history, sanitized errors, job status, and connection availability.
- [x] **4A.02** Identify the failing stage before changing code: component input, gateway validation, backend rule, external account, provider, or result display.
- [x] **4A.03** Reuse the existing project and service identity. A repair should not create a duplicate guest list, account connection, or service unless the requested change requires it.
- [x] **4A.04** Reproduce the failure with safe test data in a workspace.
- [x] **4A.05** Change the smallest relevant part and add a meaningful regression check.
- [x] **4A.06** Report the verified outcome and any remaining external dependency.

**Finished when:** a broken connection and a backend rule bug produce different correct repairs. The agent preserves existing records and does not repeat completed viewer actions.

Use the current [Try diagnostics design](../try-debugger-plan.md) and [notification policy](../notification-policy.md) when presenting evidence and unresolved failures.

## 4B. Update a working service without breaking shared components

**Pulled forward into Containers.** The seven existing tasks **4B.01–4B.07** now live in [1G's publication and update checklist](1g-containers.md#c-publish-connect-and-update-through-existing-commands). Their IDs and wording were preserved at transfer; all seven are now verified complete in 1G. Implement the basic update flow once, using the existing host's activation, compatibility and action-replay rules.

When Roadmaps 2/3 add external connections or background jobs, extend and verify that same update flow for those effects. Returning to old code must not replay an external write or rewind data. No second deployment system, old manifest parser or compatibility runtime is planned here.

## 4C. Improve service management

**Basic management is pulled forward into Containers.** Existing tasks **4C.01, 4C.02, 4C.04, 4C.05 and 4C.06** now live in [1G's management checklist](1g-containers.md#d-finish-the-same-management-surface), with their original wording; all five are now verified complete in 1G. Connections, data inspection, usage/cost, pause/delete and cleanup use one service manager. Do not build them again here.

Remaining later work extends that manager:

- [x] **4C.03** Surface expiring credentials and limits through the existing status surfaces. Keep unresolved problems visible after dismissing a notice.
- [x] **4C.07** Add operational checks that detect a service whose published component still points to a missing release.

**Finished when:** once real connections and background jobs exist, their expiring permissions, unresolved work and missing-release faults appear in the same Container controls with an accurate recovery action. Basic Container lifecycle acceptance belongs to 1G; this phase adds evidence for those later capabilities.

## 4D. Expand capabilities when a real request needs them

Implement these as separate follow-on tasks. Each needs a concrete demonstration.

- [x] **4D.01** Choose one real request that requires an additional capability and record its expected behavior and access needs.
- [x] **4D.02** Implement that capability through focused adapters and shared contracts; keep creator ownership, limits, and lifecycle controls intact.
- [x] **4D.03** Verify its concrete demonstration, failure/recovery behavior, and affected Try/export/player path; record the evidence before calling it available.

| Capability | Evidence that it is needed | Proof before calling it ready |
| --- | --- | --- |
| Richer live controls | A real task needs returned lists, availability slots, or editable server data. | The data-driven control behaves the same in Try, export, and the standalone player. |
| Additional runtimes beyond Node.js | A required library or process cannot run in the Node.js Container environment delivered by 1G. | The same ownership, limits, deployment, pause/delete, and recovery contract works on the new runtime. |
| Calling or connected-device actions | A chosen workflow requires an actual phone or device operation. | A real authorized connection performs the action and reports its available evidence truthfully. |
| Account-linked agent email (paused) | Paused by the creator on 8 October 2026; do not implement in this milestone. Previously requested on 8 October 2026: give each Restyle account an agent email address linked to its creator and the creator’s verified email. This is later work, separate from Roadmap 3’s Resend connection. | Verify sender/domain ownership, keep verified user contact separate from agent identity, define who receives replies, authorize sending/receiving, and test account isolation, revocation, retention, costs and abuse limits before the agent uses it. |
| More provider integrations | Research finds a service with usable access and a creator needs it. | The connection passes setup, test/live, revocation, and failure checks. |
| Better automatic repair | Repeated failures have a safe, bounded fix. | The repair restores service and preserves existing records without repeating completed actions. |

A browser automation capability may help with some services, but account access and actual supported actions still need verification. The agent should ask for a connection or agree a manual step when it cannot establish a reliable execution path.

The paused email row above records the Roadmap 4 decision on 8 October. The creator resumed that work on 9 October with AgentMail and AgentPhone under [Roadmap 5](05-agent-identity-and-onboarding.md). The completed 4D repair capability and its evidence below stay unchanged.

## Complete this roadmap

Reuse the recorded 1G evidence for basic updates and service lifecycle. Demonstrate a real repair, the affected update/control behavior with any new connection or job capability, and one additional capability justified by a concrete request. Repeat earlier checks only where a changed dependency creates a concrete risk.

Run the focused behavior checks and affected browser paths, then complete the same beta verification and release workflow used for earlier roadmaps. Stop expanding once the chosen roadmap outcome is met; future capability requests become their own focused tasks.

## Roadmap 4 implementation checkpoint — 8 October 2026

**All eleven remaining Roadmap 4 tasks are complete through beta. All 134 tasks across Roadmaps 1–4 are checked.** Existing 1G update/management evidence remains complete; it is not counted or implemented twice. See the [portable verified acceptance](../restyle-maintenance.md#verified-acceptance--8-october-2026) and [current progress](../restyle-cloud-agent-progress.md).

4A and 4C pass owner-only read-only source/version/attachment/account/job/error observations, safe baseline and diagnosis, expiring/disconnected access, persistent limits, and missing live/recorded releases after restart. No guest data or secrets enter the observation. Backend-rule and disconnected-account faults produce distinct outcomes; repairs reuse the service and preserve records/replies through publication/rollback. Newer manual changes clear stale diagnosis and trigger a fresh baseline.

For 4D, the concrete additional request is stronger automatic repair: actual native Node commands prove that a proposed regression fails against the original saved code and passes against the repair, followed by separate unchanged independent validation. A regression that passes the original bug cannot create a checked release. Creator desktop/phone, actual compiler/iframe Try, normal export, public viewers and background receipt player pass. Model choices/provider responses/provisioning are controlled; prior live provider evidence is preserved.

Application source `66681bc`, draft [PR #109](https://github.com/jaffakakes/pvo-prototype/pull/109), remains unmerged. Combined beta `5063d97` passes build, strict types and 43 focused checks; actual Desktop beta4173 serves `restyle-editor-shell-7bbb710096de4c50` with exact byte and fresh activated service-worker verification. Generated output is backed up and 143 old hashed assets retained; no forced reload. Owned preview5327 is stopped. The isolated beta worktree is retained because app archival reports it protected by a pinned task/workspace. Static beta has no permanently configured backend APIs. Agent email remains paused; production, integration merges, Actions and deletion of unreleased branches remain prohibited.
