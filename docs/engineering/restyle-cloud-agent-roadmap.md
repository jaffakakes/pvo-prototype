# Restyle cloud agent implementation roadmaps

**Continuing with Claude Code or Codex:** read [current progress](restyle-cloud-agent-progress.md), then the [handoff/restart guide](restyle-cloud-agent-handoff.md). Every checklist item now has a stable task ID. After each verified task, check it off and save its evidence and exact next action. Root [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) require this workflow.

Status: **Roadmap 1, all 2A/2B and six 2C tasks verified, 8 October 2026 — 93/134 complete; 41 remain.** Connected Container source passes local checks and actual editor/viewer acceptance. **Next gate: 2C.04**, the prepared real-account/Fly proof; its separate US$1 approval is pending. The current beta remains **`restyle-editor-shell-9ba9e267c3671ed5`** until the 2C delivery is recorded. See the [connected Container contract](restyle-connected-services.md) and [progress](restyle-cloud-agent-progress.md). Permanent hosting, PR integration and production remain separate. Production is prohibited until the user tests the finished roadmap and approves release.

**Historical planning update, 6 October:** [1G Containers](restyle-cloud-agent-roadmaps/1g-containers.md) is the next product feature after 1F, before Roadmap 2. It extends the existing service system with editable saved drafts and hosted Node.js execution. Eight new unchecked tasks are added; twelve existing unchecked 4B/4C tasks are moved into that plan, with their IDs and wording retained. No completed work is reset. The user confirmed preserving the currently recorded partial 1E / unfinished 1F status. The planning update itself changed documentation only; implementation has now resumed.

Start with [Roadmap 1](restyle-cloud-agent-roadmaps/01-first-working-component.md). It delivers the first complete version: ask for a component, let the agent build a new backend, try it, and share something that keeps working after its temporary computer shuts down.

The [architecture document](restyle-cloud-agent-architecture.md) explains the idea. These roadmaps turn it into smaller pieces of work you can implement and verify.

## Production release gate — explicitly deferred

On **7 October 2026**, the user confirmed: **“We won’t release to production till everything is done and I tested it in beta.”** Therefore milestone completion means verified implementation and beta delivery, not automatic production release. Complete the remaining roadmap, keep delivering verified changes through **New beta release**, let the user test the finished beta, and obtain their explicit production approval. Then follow the protected `dev → preprod → prod` process, verify the actual live release and perform proven completed-branch cleanup. No production deployment or protection change is authorized now. This gate does not block continued implementation in beta.

## Reviewed device and cloud decision

Use the **device** for editing, previews and supported lightweight checks. Use the **temporary cloud workshop** when development needs tools, packages or heavier execution. Keep **independent publication checks** in Restyle's controlled environment and **finished viewer services/records** hosted so they work when the creator's device is off. No permanently running VM per creator is planned.

This refines existing 1G.01–03 and 1G.05/08; it adds no new task IDs or parallel agent/runtime system. See [where work runs](restyle-cloud-agent-roadmaps/1g-containers.md#where-work-runs-use-the-device-first-where-it-fits). Implementation has progressed to **87/134 complete**. The user has now requested implementation to continue; preserve this distinction throughout subsequent tasks.

## The four roadmaps

| Order | What you will have when finished | Implementation guide |
| --- | --- | --- |
| 1, then 1G | First a working component/backend; then a Containers area for manual/AI editing and checked Node.js hosting using that same service system. | [Build the first working component](restyle-cloud-agent-roadmaps/01-first-working-component.md) |
| 2 | An agent that researches outside services, asks useful questions, helps connect accounts, and continues with the chosen approach. | [Research and connect outside services](restyle-cloud-agent-roadmaps/02-research-and-connections.md) |
| 3 | Features that continue working after a viewer closes the video, with reliable messages, callbacks, schedules, and honest status updates. | [Support work that takes time](restyle-cloud-agent-roadmaps/03-background-work.md) |
| 4 | Deeper diagnosis, connection-health monitoring and additional capabilities; reuse the update/management work delivered in 1G. | [Maintain and expand the system](restyle-cloud-agent-roadmaps/04-maintenance-and-expansion.md) |

The first roadmap uses Restyle-owned storage so you can prove code generation and hosting without first needing a restaurant or messaging account. It must generate different rules for different requests. The product remains a general builder.

Every roadmap contains ordered implementation steps, relevant code areas, and observable checks. Treat each step as a focused change or small group of pull requests. The roadmap is finished only when its complete demonstration works.

## Delivery sequence and completion gates

Use the numbered tasks in the linked guide as the detailed checklist. The phase order is a dependency plan, not a calendar estimate. 1A and 1B.01–1B.15 are complete. A checked implementation task does not automatically mean its PR is merged or its feature is released.

| Phase | Deliverable | Depends on | Evidence needed to finish |
| --- | --- | --- | --- |
| **1A — complete** | Real workshop and independent hosting | Account access | Service works after workshop deletion; limits and cleanup verified |
| **1B — complete** | Saved tasks, questions, progress, resumable authoring | Existing accounts; 1A adapters for provider recovery checks | Close browser, restart runner, answer later, stop safely, and recover one existing deployment |
| **1C — complete** | Agent writes, tests, and repairs backend code | 1B task/receipt model and 1A runtime | Two different generated services pass trusted tests; invalid code cannot bypass the gate |
| **1D — complete** | Owned services, records, quotas, pause/delete | 1B records and 1C immutable artifacts | Duplicate and competing submissions behave correctly; isolation and cleanup hold |
| 1E | Verified service attached to component | 1C/1D receipts and existing editor/player boundaries | Try uses test permissions; file export and publication both use the correct live service |
| 1F | First complete product release | 1B–1E gates | Two natural-language demonstrations; restart/failure checks; beta and authorized release evidence |
| **1G — complete through beta** | Containers: saved manual/AI drafts, checked Node.js runtime, and existing service update/management flows | Completed 1E/1F; reuse 1B–1D | Exact tested Node.js release survives workshop/instance shutdown; both editing paths, attachments, costs and cleanup verified |
| **2A — complete** | Research and saved capability decisions | Product sequence follows 1G; reuse 1B saved questions and web tools | Unrelated requests produce relevant evidence, questions, and truthful options; changed goals revise the plan |
| **2B — complete** | One secure account connection | 2A access decision and owner records | Connect, reload, expire, reconnect, revoke; another owner cannot use it |
| 2C | Generated integration through controlled credentials | 1D and 2B; Roadmap 3 for long-running effects | Live supported operation; revocation and unknown-outcome handling |
| 2D | Useful manual alternatives | 1B questions and 2A research | Alternatives fit each goal; chosen manual steps stay pending until done, with no false completion claim |
| 3A | Durable viewer jobs | 1D action identities; 2B for external connections | Browser/worker restarts preserve one logical job and an accurate result |
| 3B | Provider callbacks and schedules | 3A reliable jobs | Invalid/duplicate/out-of-order events handled; cancelled schedules do not start |
| 3C | Truthful pending/final component status | 3A/3B and 1E attachment | Private receipt access, safe refresh, correct Try/export/player behavior |
| 3D | Real acceptance-triggered automation | 2C and 3A–3C | Supported provider path works with browsers closed; uncertain outcomes are reconciled |
| 4A | Scoped diagnosis and repair | Retained source and service/task records | Correctly distinguish code faults and account faults; preserve saved records |
| 4B — pulled into 1G | Basic tested updates and recovery | 1D releases and 1G Node.js drafts; extend for 2/3 later | Existing 4B.01–07 checklist appears once in 1G; preserve current records and prior working release |
| 4C — shared with 1G | Basic management in 1G; later connection-health and missing-release monitoring | Same service controls; 2/3 for connected work | Five existing tasks move to 1G; 4C.03/07 remain later |
| 4D | Additional capability justified by a request | Existing ownership/lifecycle gates | One concrete new capability meets the same isolation, recovery, and truthful-result checks |

For the current milestone, use [Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md) and the [connection contract](restyle-account-connections.md). Completed Roadmap 1 references include [1G Containers](restyle-cloud-agent-roadmaps/1g-containers.md), its [implementation contract](restyle-containers-contract.md) and the [Node provider proof](restyle-node-provider-proof.md). All Roadmap 1 gates pass; the bounded configured Node acceptance and cleanup are complete under the approved US$1 test plan. The completed [goal-continuation plan](restyle-cloud-agent-roadmaps/1b-goal-continuation.md) and [1E attachment implementation plan](restyle-cloud-agent-roadmaps/1e-component-attachments.md) retain their evidence. The completed [1D hosting implementation plan](restyle-cloud-agent-roadmaps/1d-hosted-services.md) retains its decisions and evidence. The completed [1C workshop implementation plan](restyle-cloud-agent-roadmaps/1c-generated-services.md) retains its decisions and evidence. The completed [1B implementation plan](restyle-cloud-agent-roadmaps/1b-saved-tasks.md) retains its acceptance evidence. Later milestones already contain their task breakdowns in Roadmaps 1–4; expand a task's implementation notes when starting it without renumbering or resetting completed work.

## The order inside the first roadmap

1. **1A: Check the infrastructure.** Prove that a temporary computer and a separate hosted service can actually run in the chosen account.
2. **1B: Save the task.** Keep requests, follow-up answers, progress, and project identity across reloads.
3. **1C: Give the agent a workshop.** Let it write and test new backend code in an isolated workspace.
4. **1D: Host the finished work.** Add owned services, stable addresses, saved records, usage limits, and management controls.
5. **1E: Connect PVO.** Attach a verified service to a component and support both downloaded files and published links.
6. **1F: Prove the whole flow.** Run the complete journey with two different generated features and the workspace switched off.
7. **1G: Make Containers editable and host them in Node.js.** Use one saved draft for manual/AI edits, retain the service lifecycle and connection rules, and deliver the existing basic update/management tasks here.

Complete 1E/1F first, then follow [the consolidated Container checklist](restyle-cloud-agent-roadmaps/1g-containers.md#ordered-implementation-checklist). The runtime change is an explicit 1G requirement; it does not reopen earlier Dynamic Worker evidence.

## Rules that apply from the first release

- Every task, workspace, service, and saved record belongs to a creator and project.
- Follow-up questions and completed work survive closing the editor.
- Goals have no arbitrary model-turn ceiling. Short work periods and resource controls must checkpoint and resume the same goal; use [1B.11–1B.15](restyle-cloud-agent-roadmaps/1b-goal-continuation.md) for the user-requested continuation design.
- Test execution is enforced by the server. Editing a browser field cannot turn a test into a live action.
- Time, request, storage, and spending limits are enforced outside generated code.
- The creator can stop a build, inspect a service, pause it, and delete it.
- Repeated submission of the same action does not create another logical operation.
- The component and its service are checked together before activation.
- Undoing an editor change does not undo an external message or reservation.
- A public component address grants only its intended viewer operation; it never grants creator administration.

These are working requirements for the first release. They should not be postponed to a later polish phase.

## What already exists

Restyle already has the editor assistant, public web research, account services, PVO requests, approved request hosts, response state, response templates, publishing, and reply collection.

The implementation branch now has a saved-task runner, temporary workspaces, independent checks, pinned Node.js service execution, durable service records and creator controls. Verified attachment admission and connected Try also exist; public player/export integration is verified; both live demonstrations and all 1F beta acceptance are complete. Ordinary assistant edits still reject unapproved network effects. Containers reuses the checked attachment command and evolves the service manager; it does not create parallel hosting or ownership machinery.

The current Logic authoring language exposes less than the broader PVO format. Reuse the existing response machinery and add only the controls needed by a real interaction.

A downloaded PVO and a published Restyle link are separate delivery routes. Both need a working service connection. Downloading a connected PVO must not require creating a public Restyle publication.

## How to implement each step

Start from current origin/dev on a focused branch, following the [release workflow](environments.md). Keep platform source changes separate from the generated services owned by individual creators.

Use one current contract across source, tests, fixtures, and documentation. Avoid legacy parsing, dual formats, and compatibility paths. Keep domain rules separate from UI, network calls, and provider adapters. The [coding standard](coding-standards.md) and [architecture](architecture.md) apply throughout.

For each step, record:

- What works for the creator now.
- The source changes and resources created.
- Checks that passed, checks that failed, and anything not checked.
- The remaining dependency before the next step can work.

Write those facts into the [progress log](restyle-cloud-agent-progress.md), not only the conversation. Mark the matching numbered checkbox complete only after its checks pass. For partial work, keep it unchecked and name the remaining action. The [handoff procedure](restyle-cloud-agent-handoff.md#how-completion-must-be-recorded) defines the required update and interruption checkpoint.

Use the relevant checks, rather than running every suite after every edit:

| Change | Required verification |
| --- | --- |
| Server or shared JavaScript behavior | Focused behavior tests, then npm run check before merging. |
| Editor behavior | npm run check:editor, relevant behavior tests, and the affected browser journey. |
| Compiler or Logic changes | Rust tests and formatting, rebuild WASM, and verify the compiler/player browser path. |
| Hosted infrastructure | A real controlled provider test in addition to local fixtures; record the resulting service and cleanup. |
| Documentation only | Check links, content, and consistency. |

Follow [scripts/README.md](../../scripts/README.md) for prerequisites and exact commands. App changes must reach the active beta through the documented build and release process: preserve generated output, rebuild, copy to the server's actual output directory, and verify the served service-worker revision. Do not force a reload over an editing session.

Production promotion follows dev → preprod → prod. After successful deployment and live verification, perform the required branch cleanup from [AGENTS.md](../../AGENTS.md).

## Start here

**Roadmap 1 and all 2A verified, 8 October 2026:** next is **2B.01** in [Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md). Its four stages must adapt to the actual request; the restaurant example is illustrative. See the [acceptance cases across different requests](restyle-cloud-agent-roadmaps/02-research-and-connections.md#build-from-the-creators-request). Preserve completed evidence and all stable task IDs. Production remains deferred.
