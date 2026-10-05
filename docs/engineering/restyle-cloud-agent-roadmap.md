# Restyle cloud agent implementation roadmaps

**Continuing with Claude Code or Codex:** read [current progress](restyle-cloud-agent-progress.md), then the [handoff/restart guide](restyle-cloud-agent-handoff.md). Every checklist item now has a stable task ID. After each verified task, check it off and save its evidence and exact next action. Root [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) require this workflow.

Status: implementation in progress, **6 October 2026**. **1A, 1B and 1C are verified complete (25/121 tasks).** Real infrastructure, saved tasks, task-owned workspaces, general model construction/repair, scoped research and independent behavior validation are implemented and checked. **Next: 1D.01/1D.02, owned services and inactive releases.** The complete generated-component live journey remains 1F; beta delivery, remote integration and production are separate states. See [current evidence](restyle-cloud-agent-progress.md), the [infrastructure proof](restyle-cloud-infrastructure-proof.md) and the [provider recovery proof](restyle-cloud-provider-recovery-proof.md). Unchecked items remain work to do.

Start with [Roadmap 1](restyle-cloud-agent-roadmaps/01-first-working-component.md). It delivers the first complete version: ask for a component, let the agent build a new backend, try it, and share something that keeps working after its temporary computer shuts down.

The [architecture document](restyle-cloud-agent-architecture.md) explains the idea. These roadmaps turn it into smaller pieces of work you can implement and verify.

## The four roadmaps

| Order | What you will have when finished | Implementation guide |
| --- | --- | --- |
| 1 | An agent that builds a working component and a real hosted backend, with saved progress and basic management controls. | [Build the first working component](restyle-cloud-agent-roadmaps/01-first-working-component.md) |
| 2 | An agent that researches outside services, asks useful questions, helps connect accounts, and continues with the chosen approach. | [Research and connect outside services](restyle-cloud-agent-roadmaps/02-research-and-connections.md) |
| 3 | Features that continue working after a viewer closes the video, with reliable messages, callbacks, schedules, and honest status updates. | [Support work that takes time](restyle-cloud-agent-roadmaps/03-background-work.md) |
| 4 | An agent that updates and repairs existing features, with richer controls and additional runtimes when needed. | [Maintain and expand the system](restyle-cloud-agent-roadmaps/04-maintenance-and-expansion.md) |

The first roadmap uses Restyle-owned storage so you can prove code generation and hosting without first needing a restaurant or messaging account. It must generate different rules for different requests. The product remains a general builder.

Every roadmap contains ordered implementation steps, relevant code areas, and observable checks. Treat each step as a focused change or small group of pull requests. The roadmap is finished only when its complete demonstration works.

## Delivery sequence and completion gates

Use the numbered tasks in the linked guide as the detailed checklist. The phase order is a dependency plan, not a calendar estimate. 1A is complete; 1B is complete. A checked implementation task does not automatically mean its PR is merged or its feature is released.

| Phase | Deliverable | Depends on | Evidence needed to finish |
| --- | --- | --- | --- |
| **1A — complete** | Real workshop and independent hosting | Account access | Service works after workshop deletion; limits and cleanup verified |
| **1B — complete** | Saved tasks, questions, progress, resumable authoring | Existing accounts; 1A adapters for provider recovery checks | Close browser, restart runner, answer later, stop safely, and recover one existing deployment |
| **1C — in progress** | Agent writes, tests, and repairs backend code | 1B task/receipt model and 1A runtime | Two different generated services pass trusted tests; invalid code cannot bypass the gate |
| 1D | Owned services, records, quotas, pause/delete | 1B records and 1C immutable artifacts | Duplicate and competing submissions behave correctly; isolation and cleanup hold |
| 1E | Verified service attached to component | 1C/1D receipts and existing editor/player boundaries | Try uses test permissions; file export and publication both use the correct live service |
| 1F | First complete product release | 1B–1E gates | Two natural-language demonstrations; restart/failure checks; beta and authorized release evidence |
| 2A | Research and saved capability decisions | 1B saved questions; existing web tools | Online, phone-only, and no-booking examples produce truthful available options |
| 2B | One secure account connection | 2A access decision and owner records | Connect, reload, expire, reconnect, revoke; another owner cannot use it |
| 2C | Generated integration through controlled credentials | 1D and 2B; Roadmap 3 for long-running effects | Live supported operation; revocation and unknown-outcome handling |
| 2D | Useful manual alternatives | 1B questions and 2A research | Chosen manual step stays pending; RSVP is never labelled a confirmed booking |
| 3A | Durable viewer jobs | 1D action identities; 2B for external connections | Browser/worker restarts preserve one logical job and an accurate result |
| 3B | Provider callbacks and schedules | 3A reliable jobs | Invalid/duplicate/out-of-order events handled; cancelled schedules do not start |
| 3C | Truthful pending/final component status | 3A/3B and 1E attachment | Private receipt access, safe refresh, correct Try/export/player behavior |
| 3D | Real acceptance-triggered automation | 2C and 3A–3C | Supported provider path works with browsers closed; uncertain outcomes are reconciled |
| 4A | Scoped diagnosis and repair | Retained source and service/task records | Correctly distinguish code faults and account faults; preserve saved records |
| 4B | Tested updates and recovery | 1D releases, 1E attachments, 4A diagnosis | Good replacement works; broken replacement leaves prior release available |
| 4C | Better service management | 1D basic controls; 2/3 for connected work | Creator can identify failure, control usage, and retire resources safely |
| 4D | Additional capability justified by a request | Existing ownership/lifecycle gates | One concrete new capability meets the same isolation, recovery, and truthful-result checks |

For the current milestone, use the [1C workshop implementation plan](restyle-cloud-agent-roadmaps/1c-generated-services.md). The completed [1B implementation plan](restyle-cloud-agent-roadmaps/1b-saved-tasks.md) retains its acceptance evidence. Later milestones already contain their task breakdowns in Roadmaps 1–4; expand a task's implementation notes when starting it without renumbering or resetting completed work.

## The order inside the first roadmap

1. **1A: Check the infrastructure.** Prove that a temporary computer and a separate hosted service can actually run in the chosen account.
2. **1B: Save the task.** Keep requests, follow-up answers, progress, and project identity across reloads.
3. **1C: Give the agent a workshop.** Let it write and test new backend code in an isolated workspace.
4. **1D: Host the finished work.** Add owned services, stable addresses, saved records, usage limits, and management controls.
5. **1E: Connect PVO.** Attach a verified service to a component and support both downloaded files and published links.
6. **1F: Prove the whole flow.** Run the complete journey with two different generated features and the workspace switched off.

Work on the workspace and hosting can overlap once their input and output agreement is defined. Connect the whole flow before expanding the system to more providers or runtimes.

## Rules that apply from the first release

- Every task, workspace, service, and saved record belongs to a creator and project.
- Follow-up questions and completed work survive closing the editor.
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

The cloud workspace, durable authoring task, generated service deployment, and automatic service attachment are new capabilities. The current assistant rejects new or changed network effects. Extending it requires a validated attachment operation as well as model instructions.

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

**Continue with 1C.05 in Roadmap 1:** connect the saved model builder to the verified task-owned workspace tools. Save its behavior agreement before source generation, persist decisions and actual tool feedback, and repair code from real failures. Trusted approval remains in 1C.07/08. Continue local work without waiting for GitHub checks; keep remote integration and production separate. Read the current progress first.
