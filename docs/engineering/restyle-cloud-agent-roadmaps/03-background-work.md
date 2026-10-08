# Roadmap 3: support work that takes time

[Roadmap overview](../restyle-cloud-agent-roadmap.md) · [Architecture](../restyle-cloud-agent-architecture.md) · [Implemented contract](../restyle-background-work.md)
Task IDs are stable. Checked items are verified work; update their evidence and the [handoff progress log](../restyle-cloud-agent-progress.md) whenever a task finishes.


**Outcome:** a viewer can start an action, close the video, and have the service finish it. Restyle can show the recorded outcome when it becomes available.

**Depends on:** Roadmap 1's service storage and action identities. Use Roadmap 2 for any external account connection.

Keep these viewer jobs separate from the authoring task that builds the component. Building a messaging feature and sending one guest a message have different records and lifetimes.

## 3A. Save and run background jobs

- [x] **3A.01** Define one job record: service owner, service release, operation, authorized viewer reference, action identifier, input reference, current state, attempt count, and provider receipt.
- [x] **3A.02** Save the accepted job before acknowledging the request. Return a receipt meaning “request received.”
- [x] **3A.03** Add a worker that picks up saved work, records progress, and resumes after a crash. Ensure only one worker can claim the same pending attempt.
- [x] **3A.04** Use duplicate prevention both inside Restyle and at the provider boundary where supported. Accept that some uncertain external outcomes need reconciliation or human review.
- [x] **3A.05** Separate retryable failures from final failures and unknown outcomes. Use bounded retries and delays; never guess that an external write failed merely because its response was lost.
- [x] **3A.06** Add job lifetime, retention, usage limits, and creator inspection. Define what pause does to already accepted work and tell the creator.

**Finished when:** close every browser and restart the job worker during processing. The job still finishes once, or remains in an accurate unresolved state requiring a specific next step.

**Where to start:** [render job queue](../../../server/render-jobs/queue.js), [render job repository](../../../server/render-jobs/repository.js), and [iMessage queue](../../../server/imessage/queue.js) are existing lifecycle examples. Build a focused owner for generated-service jobs; do not combine these unrelated queues into one large module.

## 3B. Accept provider updates and schedules

- [x] **3B.01** Support a callback, often called a webhook: an outside service reports that a booking, message, or other operation changed state.
- [x] **3B.02** Verify who sent the callback before changing a job. Reject invalid messages and ignore already processed event identifiers.
- [x] **3B.03** Match each callback to an existing owned job. An unknown provider identifier must not create arbitrary work.
- [x] **3B.04** Handle repeated or out-of-order updates without moving a completed job back to an earlier state.
- [x] **3B.05** When callbacks are unavailable, check the existing provider operation at a bounded interval.
- [x] **3B.06** For scheduled work, store the intended time and timezone, the service release, its limits, and its cancellation state. The server starts it even if the creator's device is off.

**Finished when:** duplicate, invalid, delayed, and reordered provider events produce the correct saved status. Cancelled schedules never start a new external action.

Start with one real provider path. Add scheduling only after the job and outcome lifecycle is reliable.

## 3C. Show the real result in the component

- [x] **3C.01** Define the common result states needed by the first interaction: received, pending, confirmed, failed, and needs checking.
- [x] **3C.02** Store a receipt the viewer is allowed to inspect. Publicly guessing a job ID must not expose someone else's private booking or contact details.
- [x] **3C.03** Reuse existing PVO response state and templates for immediate results.
- [x] **3C.04** Add a bounded way for a supported player to refresh a pending receipt. Stop listeners or status checks when the view is removed; the server job continues.
- [x] **3C.05** If a guest must return later or from another device, implement an appropriate receipt link or identity check. Define recovery before promising it.
- [x] **3C.06** Make labels reflect actual evidence: “message accepted by sender,” “delivered,” and “reservation confirmed” are separate outcomes.
- [x] **3C.07** Update the shared contract, compiler only if needed, editor preview, export, and standalone player together. Maintain one current contract.

**Finished when:** the viewer sees receipt → pending → actual result. Closing or reopening the video does not duplicate the action, and the displayed status matches the server record.

**Where to start:** [SDK runtime](../../../packages/pvo-sdk/runtime/PvoRuntime.js), [player action adapter](../../../player/actions/runtime.js), [PVO actions](../../../SPEC.md#actions), and [Logic guide](../../language/README.md#logic). A pending HTTP reply by itself is not a completed booking.

## 3D. Demonstrate a useful automation

- [x] **3D.01** Build an acceptance flow that records the reply and triggers a message through a real supported connection.
- [x] **3D.02** Test the normal path, sender offline, expired credentials, provider timeout after acceptance, duplicate click, duplicate callback, and cancelled work.
- [x] **3D.03** Confirm that ordinary Try cannot send live messages.
- [x] **3D.04** Confirm that deleting a local component does not erase evidence of previously performed actions.
- [x] **3D.05** Verify that a creator can inspect failures and safely resume only work that remains unfinished.

For iMessage, the existing feature is a fixed-message Mac test bridge. General messaging requires its own sender availability, account ownership, queue behavior, and truthful status handling. Do not treat a cloud VM as an iMessage sender without implementing a real connected sending path.

## Completion evidence — 8 October 2026

**All 24 Roadmap 3 tasks are verified through beta.** The [portable acceptance evidence](../restyle-background-work.md#verified-acceptance--8-october-2026) separates actual Resend delivery, controlled failure/callback tests, local Node/SQLite execution and delivered beta UI. Production and permanent beta backend hosting remain separate. See the current [progress](../restyle-cloud-agent-progress.md) for source, cleanup and the next roadmap.

## Complete this roadmap

Release only after the actual job continues with browser sessions closed, saved results survive restarts, and duplicate or uncertain requests cannot silently repeat the external action.

Use focused job and callback tests, player/browser checks, and a controlled live provider run. Record what the provider can confirm; do not claim delivery where only command acceptance is available.

Next: [Roadmap 4 — maintenance and expansion](04-maintenance-and-expansion.md).
