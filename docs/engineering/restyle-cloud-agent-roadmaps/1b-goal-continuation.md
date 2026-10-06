# Saved goals that continue until the work is done

[Numbered tasks 1B.11–1B.15](01-first-working-component.md#goal-continuation-correction--6-october-2026) · [Progress](../restyle-cloud-agent-progress.md)

## In everyday terms

The creator gives Restyle a goal. Restyle keeps a notebook, does a manageable piece of work, saves what happened, and starts the next piece. A worker or temporary computer may stop; the goal remains. A failed test supplies information for repair. It does not use up an arbitrary allowance of chances to think.

The creator can stop the work. Restyle can ask for missing information or spending permission. If a provider is temporarily busy, Restyle saves its place and waits. It says exactly why it is waiting and how to resume. Completion means the requested result has been checked, not that a counter ran out.

## Confirmed correction

The user explicitly rejected a fixed model-turn ceiling on 6 October 2026. The six/eight-turn cutoff is removed from task validation, builder-round accounting, runner admission and model prompts. Accounting still records calls and reconciles outstanding reservations. Ten durable model rounds and 100 counted turns pass local regression checks. The subsequent lifetime slice also removes the fixed 24-hour goal deadline, three-recovery ceiling and four-session ceiling. Unfinished goals keep null finish/retention timestamps; only Ready/Stop starts seven-day retention. A worker claim and each recorded inactive publication retain their own bounded lifetime. The verified operation checkpoint slice removes fixed tool/research/workspace-action/source-revision/review totals, archives settled receipts atomically, and passes 1,375 local tests. Answered-question history, bounded evidence retrieval and capacity waits are still incomplete.

## Implementation boundaries

| Task | Responsibility | Required evidence |
| --- | --- | --- |
| 1B.11 | Goal lifecycle versus a worker claim/work period; explicit waiting reason and resumable cursor | A goal survives multiple workers and work-period expiry with one current owner; Stop fences late results; no restart from scratch |
| 1B.12 | Durable compact checkpoints and separate journals | More than 64 settled entries and 24 tool actions continue; unknown effects and unsettled usage are never discarded; full restart reconstructs the same source, plan and ownership |
| 1B.13 | Spending authorization and capacity scheduling adapters | Missing permission starts no paid work; exhausted capacity saves a wait with a meaningful next action; approved allowance resumes the same goal without duplicate work |
| 1B.14 | Evidence-driven authoring/repair orchestration | Actual failing compiler/behavior evidence reaches the next decision; repeated ineffective work yields an actionable request for help; only independent success evidence completes the goal |
| 1B.15 | Combined acceptance and delivery | Controlled long runs pass former limits, browser closure/restart/Stop recovery, uncertain effects and replay tests; beta and handoff are updated |

## Existing code that needs attention

- `packages/pvo-assistant/tasks/`: lifetime/retention, retries, question and operation history bounds, tool accounting. Keep individual payloads finite and JSON-safe. Do not replace a small arbitrary goal-wide counter with a large arbitrary counter.
- `packages/pvo-assistant/builder/`: bounded feedback and workspace/research decisions. Keep one coherent current context and archive settled evidence instead of silently removing facts needed for repair.
- `server/assistant/tasks/`: durable claims, operation journals, usage reservations and alarms. Individual execution must remain time-bounded and cancellable; the next work period resumes the goal.
- `server/assistant/workspaces/` and its actual owning adapters: temporary workspace count/lifetime and exact saved source restoration. Concurrency, memory and per-command runtime controls protect the platform while another period can continue.
- `server/assistant/budget.js`: daily and minute allowances currently deny by model-call count. Introduce a separate saved-goal budget/capacity policy instead of changing the foreground editor contract incidentally. Spending control needs trusted authorization and conservative settlement when usage is uncertain.
- `server/assistant/attachments/`: compiler and hosting failures must become saved repair evidence. Keep actual owned service receipts, account/project checks and unknown-effect reconciliation.
- `editor/src/features/assistant/saved-tasks/`: present working, waiting, needs help, stopped and complete honestly. A wait must not look like finished work or lost work.

Keep provider source/data retention and execution cleanup separate from the lifetime of the goal. Deleting an inactive build computer must not erase its saved source or an activated service. Never retry an uncertain deployment, message or booking just because a work period ended.

## What remains protected

Individual calls, payloads, sandbox memory/CPU, concurrency and outbound capabilities remain bounded. Costs require the configured owner allowance. These protect each action; they do not set a fixed number of thinking turns for completing the goal. No new paid run is authorized by this design change. Existing US$1 and US$15 diagnostic approvals have already finished with cleanup.
