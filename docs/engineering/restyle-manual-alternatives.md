# Useful manual alternatives — Roadmap 2D

[Roadmap 2](restyle-cloud-agent-roadmaps/02-research-and-connections.md#2d-make-manual-alternatives-useful) · [Research contract](restyle-research-contract.md) · [Progress](restyle-cloud-agent-progress.md)

## In plain language

If Restyle cannot finish the requested outside action, it can offer something useful toward that goal. It explains what it can prepare, what it cannot do yet, what information it needs, and what a person must still do. The proposal comes from the actual request and research. There is no fixed restaurant, messaging or application template.

The creator chooses **Use this alternative**, then saves the answer. Another answer asks the AI to reconsider; it does not approve the displayed plan. Only after that saved choice can the agent agree and build the changed outcome. The original request stays in the same saved task.

A prepared component shows the agreed limitation and explains the purpose of its fields. **Ready · follow-up pending** means the component is prepared and some agreed human work remains. Saving preferences, preparing a draft, running Try or applying the component cannot complete a human step. The creator records what happened and chooses **Mark completed** or **Cancel step**. Cancellation never means the original action happened.

## Current contract

| Responsibility | Existing owner and change |
| --- | --- |
| Propose an alternative | The builder's `manual_alternative` decision references a current, same-task capability receipt. It records the original operation, prepared outcome, limitation, viewer notice, needed fields with purpose, and human instructions. Available capabilities, invented receipts, wrong operations and stale evidence cannot justify this decision. |
| Save consent | The existing question/answer transition copies the exact accepted proposal into `TaskRecord.manualPlans`. Only the explicit acceptance text selects it. No account, external effect or spending permission is granted. |
| Agree and build | Alternatives are chosen before the immutable service agreement. Its description must retain the chosen prepared outcome. A recorded unsupported operation cannot silently become an ordinary agreement without the saved alternative; connected agreements continue through their separate account/research gates. |
| Add fields | Existing `component.add` / `component.source` commands and normal guarded application apply changes. The attachment compiler checks field names/types, visible labels containing each purpose, an input binding for each agreed field, and the agreed pending-action notice in the form heading, card body or choice prompt. No PVO format or Logic language extension. |
| Record human work | Authenticated `POST /api/assistant/tasks/:id/manual` accepts `{expectedRevision,questionId,stepId,operationId,status,note}`. Status is `completed` or `cancelled`. Owner, origin, revision and identity checks apply. Generated code and model decisions have no equivalent completion tool. A note records the creator's assertion; it is not provider verification. |
| Keep context | Accepted plans and resolutions remain in the same task even after old questions are archived. Original input, answers, automatic operation receipts and independent reports retain their existing owners. Returning later shows the chosen outcome and outstanding steps. |
| Retention and cleanup | Pending human work prevents terminal task content from expiring. It does not keep a VM or worker running. Automatic work still ends at `ready` or `stopped`, and existing workspace/provider cleanup runs. Once all human steps are completed or cancelled and automatic work has ended, ordinary seven-day task retention begins. Stop stops the AI; cancelling human obligations is explicit. Existing retained-task/storage quotas apply. |

Proposal bounds: at most eight accepted plans per retained task, eight fields and eight human steps per plan. These bound saved payloads and UI, not model execution turns. Each resolution note is at most 1,000 UTF-8 bytes. All new records use the canonical `manualPlans` field; there is no legacy dual-read path or migration for development fixtures.

## Ownership and continuation map

- `packages/pvo-assistant/tasks/manual.js`: pure proposal, consent, resolution and retention rules; `manual-schema.js` supplies the model shape; `manual-component.js` validates compiled controls and bindings.
- `server/assistant/builder/manualAlternatives.js`: current research boundary and agent guidance. `authoringResponse.js` supplies retained plans in inference evidence. Builder repository saves the structured question using the normal transaction.
- `server/assistant/tasks/`: existing private route, coordinator and repository apply creator commands atomically. Manual follow-up starts no additional job queue, scheduler or provider adapter.
- `editor/src/features/assistant/saved-tasks/`: proposal explanation, normal answer controls and human checklist. Existing task session refreshes before commands, preserves retry identities and hides private state after an account/project switch.
- `server/assistant/attachments/preparation.js`: exact proposed source is compiled and checked before its immutable result is saved. The editor's existing application path rechecks ownership, project snapshot and connected-service authority.

## Verification and practical limits

The committed fixtures cover table booking, grant submission and an unfamiliar river gauge, including a changed request. They exercise the real saved runner, SQLite, HTTP routes, research receipts, questions, choices and restarts. The end-to-end local case continues through a controlled model/source, independent expected-result comparisons, local Node execution adapter, hosting receipts, attachment compilation and an immutable prepared result. The service reports `saved_for_manual_followup`; the human step remains pending.

Tests reject invented capability receipts, changed/missing agreed notice or data-purpose labels, stale revisions, another owner, an invalid origin and added completion authority. They cover rejected/free-text alternatives, question archiving, Stop, explicit cancellation, resolution replay and expiry after the final human result. The browser check covers the actual desktop/phone editor, normal component application, compiled fields, Try, browser/server restart, a lost resolution reply and account switching.

Reproduce from this branch:

```sh
npm run check
npm run check:editor
# Run source Vite separately; this starts no paid infrastructure.
./node_modules/.bin/vite --config editor/vite.config.ts --host 127.0.0.1 --port 5324 --strictPort
EDITOR_URL=http://127.0.0.1:5324/ npm run check:browser -- editor manual-alternatives
```

The controlled planner demonstrates continuation and enforcement, not new live-model quality or real bookings, calls, submissions or messages. Structural gates enforce the chosen fields and notice; they cannot independently certify the meaning of every generated sentence. Creator review and request-specific independent examples remain necessary. Earlier real 2B/2C account/Fly acceptance remains valid and is not rerun for this milestone.

These are **human follow-ups for the authoring task**. Individual viewer submissions use the generated service's existing durable records. Per-viewer jobs, verified asynchronous completion, callbacks and schedules belong to [Roadmap 3](restyle-cloud-agent-roadmaps/03-background-work.md). There is no general service callback that marks these human steps completed. After the service agreement is frozen, a changed promise requires a new task rather than replacing that agreement.

Beta delivery and source completion are recorded in [progress](restyle-cloud-agent-progress.md). The local static beta does not configure a permanent task/account/service backend. Production remains deferred until the full roadmap, user beta testing and explicit release approval.
