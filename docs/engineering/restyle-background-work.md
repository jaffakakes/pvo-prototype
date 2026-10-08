# Background work and private receipts

[Roadmap 3](restyle-cloud-agent-roadmaps/03-background-work.md) · [Architecture](restyle-cloud-agent-architecture.md) · [Progress and evidence](restyle-cloud-agent-progress.md) · [Connected services](restyle-connected-services.md)

## In plain English

A viewer can accept an invitation and close the video. Restyle first saves that request, then its server runs the approved Container operation. The viewer gets a private receipt to check later. The creator can inspect unfinished work in **Containers → Records and usage → Background work**.

The temporary VM remains the AI's workshop. The published Node.js Container runs the finished program. A saved background job is one viewer request for that program to finish; it is not another VM, another hosting system, or the task that writes the program.

Resend is the first message provider. The creator approves one sending address and one recipient. The Container supplies only a subject and plain text within the agreed limits. Try uses saved example replies and cannot send real email. Account-linked agent email is later Roadmap 4D work; this implementation does not create an email identity for each account.

## Responsibility and one current contract

| Owner | Responsibility |
| --- | --- |
| `packages/pvo-assistant/jobs/` | Job transitions, limits, private/public projections, receipt validation and provider evidence rules; no browser or network effects. |
| `server/cloud-services/jobs/` | SQLite admission/claims, durable alarms, owner inspection/control, bounded status checks and verified callback matching inside the existing per-service object. |
| `server/connections/` | Encrypted credentials, exact approved account scope, fixed provider URLs, durable external-write journal, status lookup and callback signature verification. |
| Existing Node host | Execute the independently checked release and commit its agreed state/result. Provider credentials never enter generated Node code. |
| Shared attachment client | Save viewer intent and private receipt key before sending; use one action identity across interruptions. |
| Editor/player | Editor Try stays offline with respect to provider writes. The player refreshes one private receipt while its view exists. |
| `/receipt.html` | Read one saved public result using the private fragment key, including from another browser/device. It never submits or resumes work. |

There is no new PVO Logic syntax. The existing request envelope and the host's `responses.<componentId>` state remain the integration point. An agreed operation may declare `delivery: "background"`; its live host returns `{actionId, job:{status,label,updatedAt,result,expiresAt,nextCheckAt}}`. Try wraps its checked example result in the same envelope and labels it as a test. Ordinary immediate operations retain their own immediate response contract. Schemas, declarations, editor attachment/export and player admission recognize the same operation discriminator.

## Saved lifecycle and duplicate prevention

1. The viewer host creates a random 32-byte receipt key, action ID and exact input, and saves them in IndexedDB before dispatch.
2. `POST /api/services/{serviceId}/jobs` validates the live checked release, operation, public input and release-specific account approval. It saves the job and recovery alarm before returning HTTP 202 (**request received**, not operation complete).
3. One durable worker claims the due job. The two-minute claim lease and claim-ID settlement fence prevent concurrent or stale workers from committing the same attempt. The existing Container action journal and provider journal protect repeated execution.
4. A completed Node operation commits business records and a result. If email has only been accepted by Resend, the job remains pending while bounded status checks or signed callbacks record delivery evidence.
5. Read-only receipt checks never create jobs. A replay of the original submission retains its action, input and receipt key. Changed input cannot overwrite unfinished work. Unknown external outcomes remain saved and hold later execution until inspected.

An email request uses a provider idempotency key derived from the owner, service, action and request index. After a lost response, reconciliation may replay the exact request only within 23 hours of first dispatch, leaving headroom inside [Resend's documented 24-hour window](https://resend.com/docs/dashboard/emails/idempotency-keys). A changed sender key cannot replay an uncertain write under a different provider identity. Outside the safe window, Restyle keeps the result unresolved for manual inspection; it cannot promise universal exactly-once execution for arbitrary providers.

## Status means evidence

| State | Viewer meaning |
| --- | --- |
| `received` | The request is saved; it may be scheduled or held by pause. |
| `pending` | Work is running or the email sender has accepted it; delivery may still be pending. |
| `confirmed` | The agreed operation finished and required evidence is recorded. Email delivery means the recipient's mail server accepted it. |
| `failed` | A final failure, rejection or safe pre-start cancellation is recorded. |
| `needs_checking` | The outcome is uncertain, its lifetime/retry allowance expired, or delivery could not be confirmed. The creator has a specific inspection/resume path. |

An acceptance recorded in the Container, an email accepted by the sender, an email delivered to a mail server, a person reading it and a restaurant confirming a reservation are different facts. This implementation does not infer the latter two. Terminal provider evidence is not moved backward by duplicate, older or delayed events. A polling response cannot overwrite newer callback evidence.

## Callbacks and status checks

The private account-access view exposes the fixed callback URL for the checked email binding. The creator can configure it in Resend and save the signing secret in their account connection. The route is `POST /api/services/{serviceId}/resend/{connectionId}`. The URL contains no credential; raw request bytes and Svix ID/timestamp/signatures authorize each update. Requests have a 16 KiB bound and a five-minute signature timestamp tolerance, including key-rotation signatures. See [Resend's verification requirements](https://resend.com/docs/webhooks/verify-webhooks-requests).

An update must match exactly one existing job's connection and email ID. Unknown IDs create no work. Recorded event identifiers are deduplicated. A callback arriving before the provider ID is durably recorded returns `recorded:false`; the bounded status lookup recovers the result. No endpoint accepts arbitrary provider URLs or email IDs for status reads: lookup requires the owned completed provider journal entry.

Without callbacks, delivery lookup uses [Resend's retrieve-email status](https://resend.com/docs/api-reference/emails/retrieve-email). It starts after one minute, backs off to one hour and stops after twelve checks. Transient status-read failures remain pending within that allowance. Expired credentials require reconnecting; unfinished external writes retain their original journal and identity.

## Scheduling, pause and deletion

The job API accepts `schedule:null` or `{at,timezone}` with an absolute millisecond timestamp and a valid IANA timezone, up to thirty days ahead. It stores the exact release, input, limits and cancellation state. Durable alarms start due work without a creator/viewer browser. A future job does not block an earlier due request. This is a server contract; there is no general scheduling editor or natural-language timezone parser in this milestone.

Pause stops further execution and delivery checks and holds accepted queued work. It cannot unsend a message or stop a provider that already accepted one. Signed callbacks can still record existing evidence. Jobs still reach their lifetime while paused. Cancelling is allowed only when the platform can establish that the action has not started; dispatched or uncertain external actions cannot be labelled cancelled merely because the creator clicked a button.

Deleting a local component removes its local UI, not hosted action evidence. Deleting a Container or switching its release is blocked while accepted work remains unfinished. Once allowed, completed job receipts remain readable until retention expiry even when executable code is removed. Uncertain work requires inspection, not a silent destructive cleanup.

## Ownership, privacy, limits and costs

Creator inspection/control requires the service owner's current authenticated account. Its summary includes status, attempts, times, reason and provider receipt, but omits full submitted fields, private receipt keys and credentials. Callback matching is scoped to the same service owner/account. Wrong-account calls do not reveal another creator's jobs.

Anonymous viewer receipt access requires a random private key whose digest is stored on the server. Guessing an action ID is insufficient. A private link carries the key after `#`, so it is not sent in the page URL, query or referrer. Its read-only POST sends the key only to the fixed service route with cookies omitted. Anyone holding that link can read that one agreed public result. Clearing browser storage and losing the link loses anonymous recovery. Keys never appear in a public PVO manifest or generated renderer.

| Safeguard | Current limit |
| --- | --- |
| Saved jobs per Container | 128, within 4 MiB |
| New accepted jobs | 256 per UTC day, also subject to existing service/account capacities |
| Automatic execution attempts | 5 with delays; unknown external writes require inspection |
| Job lifetime | 7 days after intended start |
| Completed receipt retention | 30 days after settlement |
| Unresolved evidence | Retained for inspection, bounded by saved-job capacity |
| Automatic delivery checks | 12 per recovery cycle |
| Visible viewer receipt checks | 12 sequential checks, 5–30 seconds apart; explicit later read allowed |
| Creator resume | Explicit, original release only; renews a bounded recovery cycle without creating a new action |

The automatic viewer watcher aborts on view/account/project replacement and clears timers/listeners. Server jobs continue. These are usage safeguards, not model-turn limits or a bill. Node execution, durable storage and provider messages can incur their normal charges. This milestone adds no subscription, paid deployment or purchase. Existing provider account allowances apply.

## Verification and continuation

Focused Node/workerd/SQLite tests cover saved-before-acknowledgement, lost replies, full restart, claim interruption, provider acceptance timeout, unavailable sender, expired credentials/reconnect, rotated-key fence, callback verification/dedup/order, polling bounds, schedule/cancellation, privacy, lifetime and retention. Real durable-alarm scheduling is exercised without any browser or manual sweep. The useful acceptance example executes independently checked JavaScript in real local Node processes; its test expectations remain outside generated code. These local processes are not a new proof of cloud sandbox isolation.

The standalone player browser acceptance compiles and packages a PVO, loses the first acknowledgement, closes every viewer, restarts the worker, retrieves the saved result, opens its private link in a new profile, rejects a wrong key and checks desktop/phone layouts. It uses a controlled external email provider. Real Resend acceptance and final beta delivery are separate gates, recorded in the [progress log](restyle-cloud-agent-progress.md); do not infer them from controlled tests.

Next agent: read the current handoff and progress first. Preserve prior Roadmap 1/2 cloud evidence, the exact active branch and all unfinished checkboxes. Do not repeat a paid test because a private local log is unavailable. Production remains prohibited pending the rest of the roadmap, user beta testing and explicit release approval.
