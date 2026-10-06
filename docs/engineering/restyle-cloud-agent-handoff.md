# Restyle cloud agent: start here when taking over

This is the restart guide for **Claude Code, Codex, or another coding agent**. It is designed to work without the previous conversation. The [progress file](restyle-cloud-agent-progress.md) says exactly where work stopped; the [roadmaps](restyle-cloud-agent-roadmap.md) hold the completion checkboxes.

## The user's goal

A creator describes a component in Restyle. The agent figures out what is needed, asks useful follow-up questions, writes and tests any required backend code in a temporary cloud computer, hosts the finished service, and connects the component to it. The service keeps working after its building computer and the creator's browser close.

Examples include restaurant planning, invitations, reservations, equipment requests, and messaging. They illustrate the general building capability. Do not turn the product into a fixed list of these templates. When a goal needs an account, calling capability, or manual action, research the options, explain the missing piece, save the creator's choice, and continue from it.

PVO remains the component and interaction format. Trusted platform code owns private credentials, storage permissions, request validation, deployment, limits, and external effects. A VM supplies a development environment; account integrations and reliable background jobs still need their own implementation.

## Read in this order

1. [Repository rules](../../AGENTS.md), [coding standard](coding-standards.md), and [architecture](architecture.md).
2. [Current progress](restyle-cloud-agent-progress.md): active task, partial changes, blockers, verification, and next action.
3. [Cloud agent architecture](restyle-cloud-agent-architecture.md): intended behavior and boundaries.
4. [Roadmap overview](restyle-cloud-agent-roadmap.md) and only the detailed milestone being implemented.
5. [Infrastructure evidence](restyle-cloud-infrastructure-proof.md) when touching workspace or hosting adapters.

## Locate the actual code before editing

At the initial handoff on **5 October 2026**:

| Item | Verified location or state |
| --- | --- |
| Repository | `https://github.com/jaffakakes/pvo-prototype` |
| Implementation checkout | `/Users/christinasmacbook/.codex/worktrees/restyle-cloud-infrastructure-proof/pvo-prototype` |
| Infrastructure branch | `feature/restyle-cloud-infrastructure-proof` |
| Tested implementation commit | `86945592255b3ba55f5b94ab3136ad7e9f71ed50` |
| Pull request | [#80, targeting dev](https://github.com/jaffakakes/pvo-prototype/pull/80) |
| Integration base at handoff | `origin/dev` at `19cd06516a959c5b7bfb7779c9ee8bb86106e271` |
| Desktop checkout | `/Users/christinasmacbook/Desktop/pvo-prototype`, detached, with existing pending `dist/` changes |

These are the initial snapshot. **Current checkpoint:** **1A, 1B.01–1B.12, 1C–1D and 1E.01–1E.03** are verified, **38/126 tasks complete**. The next priority is **1B.13** spending/capacity waits, 1B.14/15 and **1E.04**. Active checkout is `feature/restyle-goal-continuation` at `/Users/christinasmacbook/.codex/worktrees/restyle-goal-continuation/pvo-prototype`, based on dev `cc2193e` with unreleased attachment prerequisite `7fd6d9c`. Full local checks pass **1,384 tests**, 736 syntax/855 dependency/407 formatting checks and strict editor types. Existing [draft #102](https://github.com/jaffakakes/pvo-prototype/pull/102) holds the source. Current served beta contains `92d344d` at **`b77123ef32722ce1`**; combined build/types/28 focused tests/both saved-task browser journeys and Worker dry run passed. Read progress for delivery and backups. No product Worker deployment is claimed.

**User correction (6 October): no arbitrary model-turn ceiling.** Fixed goal-wide model/tool/research/session/source/review/question/recovery counts and the goal-age deadline are removed. Checkpointing preserves private archives, answers, original input, frozen agreement and exact current source. Unknown outcomes and replay IDs cannot be discarded. Inference projects bounded retrievable context and saves untrusted working notes. **1B.11/1B.12 are checked.** Actual capacity denial still becomes a failure and must become a saved resumable wait in **1B.13**. Read [the continuation plan](restyle-cloud-agent-roadmaps/1b-goal-continuation.md). Do not describe the complete harness as finished until the remaining pause/repair/acceptance work is verified.

The user explicitly said **“So leave out that GitHub checks.”** Continue local implementation and checks without polling, retrying or waiting for Actions. Do not remove protections or claim remote checks passed. PR integration, product Worker availability and production are separate. The US$1 workspace and earlier US$15 recovery test batches both finished with cleanup; neither approval covers new paid runs.

Historical 1B.02 checkpoint: PR #81 is merged into `dev` at `2013da2`. The active project-link branch is `feature/restyle-task-project-link`, in `/Users/christinasmacbook/.codex/worktrees/restyle-task-project-link/pvo-prototype`. Its local beta revision is `restyle-editor-shell-8e25ded02bf27bd6`; production was not changed. Read the progress checkpoint for its current PR and commit. Fetch and inspect current state before continuing; updated handoff documents can be committed after the tested implementation commit.

Start with read-only checks:

```sh
pwd
git status --short
git worktree list
git fetch origin
git log -5 --oneline
git status --short --branch
```

On this Mac, open the current implementation checkout named in the progress file to inspect the actual code. The Desktop copies make documentation easy to open; they do not mean the Desktop checkout contains the implementation. Preserve existing generated assets and other agents' work.

The authoritative progress is the version on the active implementation branch, then the integration branch after merge. Desktop copies are readable snapshots. At a handoff on this Mac, refresh those copies only after checking that they have not been edited independently; otherwise preserve both changes and reconcile them. When the working branch changes, update the checkpoint's branch and checkout instead of treating this initial path as permanent.

On another machine, clone the repository normally and fetch its branches. Inspect the PR named in the current progress file to find the latest branch or merged successor. The committed code, checklists, and recorded evidence are sufficient to resume; ignored local receipts may be absent. Missing private logs are not a reason to recreate already completed paid resources.

Follow the [branch workflow](environments.md) for new implementation: use current `origin/dev` and a focused branch. If a required prior slice has not entered `dev`, record and resolve that integration dependency through the normal PR process. Do not silently treat a feature branch as production or accumulate later milestones there.

## What has actually been completed

**1A, the infrastructure proof, is verified.** Two real cloud runs created and tested a simple service in Linux, saved it outside the VM, removed the whole workspace deployment, and successfully called the separately hosted service. Authentication, failure and timeout cleanup, byte limits, a 50 ms CPU limit, and a 20-call quota were exercised. All disposable cloud resources were deleted and their absence verified.

The implementation uses native Cloudflare Containers for the workshop and Dynamic Workers for the hosted service. The user enabled Workers Paid. Optional Workers for Platforms dispatch is not required. The proof is a fixed diagnostic under `scripts/checks/cloud-agent-infrastructure/`; it is not the product's model-driven builder.

**1B.01 is implemented and verified:** bounded task records, pure state transitions, question/receipt replay rules, execution claims, reservations, cancellation, and expiry. Read [the contract](../../packages/pvo-assistant/tasks/README.md). **1B.02 is also verified:** account-scoped locators survive local saves/reloads, copied projects drop associations, and stale replies cannot cross project/account switches. **1B.03 is verified:** durable owned project/task storage and authenticated operations survive full local workerd restart. **1B.05 is also verified:** durable planning wakeups, claims, inference journals, quotas and cancellation survive browser/worker closure. **1B.04 and 1B.06 are now verified:** eligible native requests become durably linked saved tasks; lost creation responses replay the exact input after reload. The assistant task card recovers progress/questions, saves answers and supports explicit Stop, scoped retry/resume, and sign-in recovery. **1B.07 is verified:** immutable owned result storage, stable saved-media fingerprints, guarded whole-batch application and atomic apply-once receipts survive restart/reload/Undo. Changed local edits are preserved. **1B.08/1B.09 and 1B.10 are verified:** the actual Cloudflare provider recovered its original release after a forced coordinator reset before receipt, avoided duplicate creation and blocked delayed publication after Stop. Cleanup and the whole saved-task acceptance matrix passed. **1B is complete. 1C.01 is also verified:** a bounded service package references a separate behavior agreement and defines validated inputs/results/state. 1C.02/1C.03/1C.09 are now verified: isolated workspaces, stable identity/source restoration and task-integrated cleanup. The real Container test passed and all temporary resources were removed. 1C.04 is now also verified: bounded task-owned tools and saved actual feedback. **1C.05 is also verified:** the durable model builder freezes requirements, saves tool decisions, repairs from actual test results and recovers missing replies. The implementation is `809b3fb` in draft PR #91; 1C.06 follows at `573d068` and the latest beta revision is `restyle-editor-shell-f66928d9b7955f7e`. **1C.06 is also verified:** task-owned bounded public research with cited evidence, exact replay, Stop and retention; no VM or package Internet access. **1C.07/08 are verified:** immutable exact package capture, independent case execution/reporting, bounded repair feedback and restart/Stop/retention. Full local checks pass 1,309 tests. Successful validation advances through the implemented `host` stage into an owned inactive release; the later `attach` stage still reports unavailable. Ordinary native exchanges remain session-only; cloud task state lives on the server. Hosting and attachment still require the later 1D/1E adapters. The local beta Node server does not expose Worker task APIs; the verified editor journey uses real local workerd through a controlled HTTP bridge. Production was not promoted.

The [evidence document](restyle-cloud-infrastructure-proof.md) records exact resources, costs, limits, and known verification limits. Its local receipts are supplementary; the repository document is the portable summary.

## How completion must be recorded

The numbered checkboxes in the four detailed roadmap files are the authoritative task checklist. IDs such as **1B.01** remain stable; do not renumber existing tasks when inserting a later discovery. Give new tasks an unused ID and record why they were added.

Use the [progress file](restyle-cloud-agent-progress.md) as a compact working note and chronological evidence log. After each cohesive, verified task:

1. Confirm its described behavior and required acceptance checks.
2. Change its checklist marker from `[ ]` to `[x]` in the owning roadmap.
3. Add an evidence entry: task IDs, outcome, affected files, checks and results, code commit or pending changes, PR, and cloud-resource status.
4. Update the current checkpoint: next task ID, first concrete action, branch/checkout, partial changes, blockers, and tests still needed.
5. Update the overview only when a milestone changes status. Keep implementation, merge, beta, and production states distinct.
6. Commit the relevant progress and documentation alongside the implementation when making a commit. A commit containing the progress entry can identify itself as “this commit”; record its exact SHA in the next checkpoint instead of repeatedly amending a self-referencing SHA.

If only part of a task is implemented, leave it unchecked and record the completed portion. If a previously checked task is shown to be broken, reopen it and retain the earlier evidence with the new finding. Never count a mocked provider, an unexecuted test, or source code alone as a live acceptance result.

Do this after each meaningful work chunk and before yielding, changing milestone, or stopping—not only at the end of the conversation. A credit cutoff can happen without warning; frequent saved checkpoints are what make recovery possible.

## If a session ends in the middle of work

Record these in the current checkpoint whenever they change:

```text
Active task ID:
What is already implemented:
Files changed but not committed:
Last tested commit or exact pending files:
Checks passed / failed / not run:
Active processes and how to identify them:
Cloud resource journal and cleanup state:
Blocking fact, if any:
Next action, with file or command:
```

The next agent should inspect the diff and those records before editing. Check whether a command is still running before starting another. If a deploy response was lost, look up the recorded resource identity before creating anything else. A missing response is not proof of a failed deployment or an unsent message.

## Tools and access: Claude can use ordinary developer tools

The handoff depends on files, Git, Node/npm, Wrangler, and the repository's checks. Use `gh` or GitHub's UI/API for PR inspection. Codex app attachments, internal thread IDs, MCP connectors, and chat memory are optional conveniences; they are not implementation dependencies.

Install locked dependencies in the selected implementation checkout with `npm ci`. The temporary dependency symlink used during 1A was removed. Follow [script prerequisites](../../scripts/README.md) for WASM, Rust, and browser checks. Generate missing language WASM with `npm run build:language` before tests that use it; never hand-edit generated bindings.

The coding agent's credits and Restyle's application model credentials are separate. Changing which coding agent maintains the repository does not configure or replace Restyle's runtime model provider.

| Access | How to handle it |
| --- | --- |
| Cloudflare | Use the existing local Wrangler login or a privately supplied `CLOUDFLARE_API_TOKEN`. Verify availability without printing token values. Reauthenticate securely on another machine. |
| Cloudflare account | `84880ccf8f98bb789d58cbea5436a645`; read the current configuration before choosing a target. |
| Existing main Worker | `lingering-butterfly-9ba8`; the disposable diagnostic does not deploy this application. |
| GitHub | Use the developer's existing authenticated Git/gh setup; do not copy credentials into handoff files. |
| Restyle model provider | Inspect the current assistant provider configuration and secure server bindings; never put provider keys in model context or workspace source. |
| Future external services | Research actual support, then use the secure connection flow developed in Roadmap 2. |

The user approved Workers Paid and a bounded US$1 variable-usage budget for the completed proof. This records the prior authorization; it is not an unlimited budget for future providers, phone calls, or messages. On 5 October the user additionally approved US$15 for the bounded 1B.08/1B.09 recovery verification batch; one run passed and was cleaned up. The user then approved US$1 for at most two workspace diagnostic runs. Its first run passed and cleanup was verified, ending that batch. See [workspace evidence](restyle-workspace-provider-proof.md). Preserve existing authorization without asking for the same purchase or test again. Record any new required access or cost decision before its dependent action.

## Resource and release records

Before a cloud side effect, save the task/operation identity, provider target, intended resource name, limits, and cleanup responsibility outside the temporary VM. Afterward save the actual resource ID and result. Keep secrets in secret stores; log references and public identifiers only.

For production service creation, stable identities, reconciliation, abandoned-resource cleanup, and per-owner budgets must be implemented in trusted server code. The local 1A script and its final cleanup block are evidence of the infrastructure, not an unattended production lifecycle.

Use the checks relevant to the change:

| Work | Evidence needed |
| --- | --- |
| Documentation | Local links, numbered-task consistency, commands, and factual status verification |
| Shared/server behavior | Focused tests, then `npm run check` before integration |
| Editor behavior | `npm run check:editor`, focused tests, and the affected real browser journey |
| Compiler/bindings | Native tests/formatting, rebuilt WASM, and browser integration |
| Workspace/hosting | Local failure tests plus a bounded real provider test when the changed behavior needs one; record cleanup |
| App changes | `npm run build`, preserve pending output, update the actual beta server directory, verify its served service-worker revision, and let the user choose **New beta release** |
| Production release | Authorized `dev → preprod → prod` promotion, deployed revision verification, then completed-branch cleanup under AGENTS.md |

Do not rerun paid cloud proofs simply because an agent changed. Run them to verify a concrete changed behavior or resolve missing evidence. Do not force a beta reload over the user's editing session. A successful PR check is not a production deployment.

## Prompt the user can give the next agent

> Continue the Restyle cloud agent implementation. Read CLAUDE.md, AGENTS.md, docs/engineering/restyle-cloud-agent-progress.md, and docs/engineering/restyle-cloud-agent-handoff.md first. Inspect the actual branch and pending changes, then continue the next numbered task in the roadmap. Preserve existing work. After each verified task, check it off, save the evidence, and update the exact next action. Leave partial work unchecked and record it before stopping. Do not depend on the previous chat history.


Latest 1C checkpoint: implementation **`98dd960`**, [draft PR #96](https://github.com/jaffakakes/pvo-prototype/pull/96), **1,309 full local tests** and **46 combined-beta focused tests**. The active beta serves `restyle-editor-shell-285b0d16a1d49e74`, including the separate UI design and iPhone cover fixes. The progress document records exact backup/output paths. All of 1C and 1D.01/02 are complete; 1D.03–1D.05 are next. Read the newer hosting checkpoint for current checks/delivery. Do not confuse a passing local test report or static beta delivery with hosted product availability.

Latest hosting checkpoint: **1D.01/02 implementation `12ae422`**, [draft PR #97](https://github.com/jaffakakes/pvo-prototype/pull/97), **1,320 behavior tests** passed at concurrency two. Combined beta `5e4be2a` serves `restyle-editor-shell-a6daa4bf3a021fcd`. Use the progress file for backup paths and current next-slice work. The Mac encountered temporary database disk-full errors at concurrency four; keep project files/backups intact and use concurrency two.

Newest service/data checkpoint: **1D.03–1D.05 are implemented and checked**; the current progress file records this commit, the 1,330-test full run and 36 final focused checks. Product activation and active lifetime are next in **1D.06/1D.07**. Source now uses one `HostedService`/`SERVICE_HOSTS` object per stable service ID. No cloud product deployment is claimed; inspect the newest beta checkpoint separately.

Current beta caution: the concurrent publishing task's `restyle-editor-shell-c484d6b22c1aa88f` was restored after this task detected an overlapping delivery. Both builds are backed up; the progress file records exact paths. Preserve that newer PVO-link/multipart source before delivering a combined beta. Service-actions source `1e836f8` and its build/tests are verified; product Worker hosting is still not deployed.


Latest creator-controls checkpoint: **1D.06/1D.07 verified**, **32/121 complete**. Full local checks pass **1,337 tests**, strict editor TypeScript and the actual service-manager browser journey. Activated services survive authoring Stop/deadline/pruning; controls use atomic receipts/revisions and deletion clears program/records. Source/evidence are committed together on the hosting branch (#97). Next **1D.08**, then 1E attachment. The combined beta must preserve publishing `3e0cb14` and UI `43ea3fa`; current served publishing beta is `dcb3a55ad94ea198` until the delivery checkpoint in progress says otherwise. No new cloud spend or production release.

Creator-controls delivery: source **`08083f9`**, combined **`dd10ec1`**, served beta **`82416b474cd98dbd`**, preserving publishing `3e0cb14`. Build/types/57 focused cases/two browser journeys/Worker dry run passed. Backup and exact next **1D.08** action are in progress. No product Worker deployment.


Latest safe-update checkpoint: **1D.08 verified; all of 1D complete; 33/121 tasks done**. Full local checks pass **1,343 tests**, editor types and the real browser version-selection/rollback journey. Current records and action receipts survive safe switches; incompatible state/interface or missing/expired versions cannot displace the active program. Source/evidence are committed together on the hosting branch. Next **1E.01–1E.03** after the updated combined beta checkpoint. The later 4B update-authoring flow remains separate; this verifies the owned host/version mechanism. No new cloud spend or production release.

Final hosting delivery: source **`72714fe`**, combined **`5ec4eeb`**, served beta **`a393b8b8bfa8efdf`**, preserving publishing/UI/cover changes. Build/types/37 focused tests/browser version journey/Worker dry run passed; backup and receipts are in progress. Next **1E.01–1E.03**, with all 33 completed tasks recorded. No product Worker deployment.


Current attachment delivery: **1E.01–1E.03 verified, 35/121 complete**; source **`099af68`** in [draft #99](https://github.com/jaffakakes/pvo-prototype/pull/99). Combined beta **`de2e543`** serves **`1e5fde91035b8dda`** with prior UI/cover/hosting/publishing preserved. Full source checks pass 1,356 tests; combined build/types/48 focused tests/browser/dry run passed. Exact backup/receipt and next **1E.03** work are in the current progress checkpoint. No cloud product deployment or new paid resources.
