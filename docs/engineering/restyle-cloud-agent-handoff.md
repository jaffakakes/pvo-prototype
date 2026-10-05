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

These are the initial snapshot. **Current checkpoint:** 1A, 1B and 1C.01 are verified. The user explicitly said “So leave out that GitHub checks” on 5 October after GitHub-hosted jobs repeatedly failed to acquire runners. Continue local code and local checks without waiting for remote CI or PR merges. Active checkout is `feature/restyle-workspaces` at `/Users/christinasmacbook/.codex/worktrees/restyle-workspaces/pvo-prototype`, created from current dev and locally combining #87 (`2efc241`) and #88 (`5861281`) prerequisites. Remote PR integration and production remain separate. Do not remove branch protection or claim remote checks passed. 1C.02/1C.03/1C.09 are now verified; next is **1C.04**; the progress file has the exact verification/partial-work checkpoint.

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

**1B.01 is implemented and verified:** bounded task records, pure state transitions, question/receipt replay rules, execution claims, reservations, cancellation, and expiry. Read [the contract](../../packages/pvo-assistant/tasks/README.md). **1B.02 is also verified:** account-scoped locators survive local saves/reloads, copied projects drop associations, and stale replies cannot cross project/account switches. **1B.03 is verified:** durable owned project/task storage and authenticated operations survive full local workerd restart. **1B.05 is also verified:** durable planning wakeups, claims, inference journals, quotas and cancellation survive browser/worker closure. **1B.04 and 1B.06 are now verified:** eligible native requests become durably linked saved tasks; lost creation responses replay the exact input after reload. The assistant task card recovers progress/questions, saves answers and supports explicit Stop, scoped retry/resume, and sign-in recovery. **1B.07 is verified:** immutable owned result storage, stable saved-media fingerprints, guarded whole-batch application and atomic apply-once receipts survive restart/reload/Undo. Changed local edits are preserved. **1B.08/1B.09 and 1B.10 are verified:** the actual Cloudflare provider recovered its original release after a forced coordinator reset before receipt, avoided duplicate creation and blocked delayed publication after Stop. Cleanup and the whole saved-task acceptance matrix passed. **1B is complete. 1C.01 is also verified:** a bounded service package references a separate behavior agreement and defines validated inputs/results/state. 1C.02/1C.03/1C.09 are now verified: isolated workspaces, stable identity/source restoration and task-integrated cleanup. The real Container test passed and all temporary resources were removed. Next is 1C.04, bounded model tools. The build checkpoint reports unavailable until 1C supplies workspace generation. Ordinary native exchanges remain session-only; cloud task state lives on the server. New hosted-service attachment still requires the later trusted validation path. The local beta Node server does not expose Worker task APIs; the verified editor journey uses real local workerd through a controlled HTTP bridge. Production was not promoted.

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
