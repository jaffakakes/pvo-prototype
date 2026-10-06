# 1F: prove the complete journey

[Roadmap 1](restyle-cloud-agent-roadmaps/01-first-working-component.md#1f-verify-the-complete-first-release) · [Progress](restyle-cloud-agent-progress.md) · [Handoff](restyle-cloud-agent-handoff.md)

## In plain English

The earlier steps built the parts. This milestone asks the real AI to put them together twice: a dinner RSVP with limited seats, and a camera booking form that prevents overlapping bookings.

The temporary workshop writes and tests the code. The separately hosted service keeps the saved RSVPs or bookings and answers viewers after the workshop stops. Publishing makes that checked service available to its connected component; it does not share a plugin or install something for other creators.

**Status, 6 October 2026:** both approved diagnostic deployments are removed. The first exposed a model request-format issue, now repaired; the replacement reached the actual model but exposed the driver’s one-question assumption, also repaired locally. Neither demonstration reached generated source. All 1F tasks remain unchecked. The further corrected run is now approved. This is no public product deployment; beta delivery is recorded separately in progress.

## Implementation and evidence boundary

- Driver: [run.mjs](../../scripts/checks/cloud-agent-first-release/run.mjs).
- Requests: [scenarios.js](../../scripts/checks/cloud-agent-first-release/scenarios.js). They contain natural-language requests, acceptance examples and one anticipated creator answer, with no generated source, agreement, test report or model decision.
- [Diagnostic task subclass](../../scripts/checks/cloud-agent-first-release/tasks.js) uses the production planning/build/attachment functions, saved task runner, real workspace provider and independent validation. An optional model adapter parameter enables usage measurement; the production default is unchanged.
- [Worker](../../scripts/checks/cloud-agent-first-release/worker.js) exposes private test controls. Only the existing public viewer action route is cookie-free. Model credentials stay in a Worker secret, outside prompts, generated source, workspaces and browser responses.
- Current finished services execute in **Dynamic Workers**. The workshop uses a native Cloudflare Container. Hosting finished services in Node.js Containers remains **1G**, after this gate.
- [Local checks](../../tests/first-release/acceptance.test.mjs) use actual workerd/SQLite for task creation, replay, owner rejection, persistence and the spending ledger. They explicitly deny outbound network and do not count as live natural-language acceptance.

## Approved paid batch — 6 October 2026

The earlier US$15 recovery and US$1 workshop proofs are finished and cleaned up. They do not authorize this new batch. The user approved a fresh **maximum US$15** on 6 October by replying “yes i approve”, covering **one disposable deployment**, both real-model requests and their verification, with all its resources removed afterward. This is a ceiling, not a purchase price or an expected charge. This one batch is approved. Record its run and cleanup; do not silently start another deployment.

| Item | Scope / bound |
| --- | --- |
| Account | Existing Cloudflare account in `wrangler.jsonc`; existing private Runpod API key |
| Product resources | No changes to the main Worker, production database, publications bucket, domain or Runpod infrastructure |
| Temporary deployment | One randomly named Worker, one Container application, six SQLite Durable Object namespaces |
| Creators / goals | Two diagnostic owners, one saved goal each; dinner then camera |
| Workshop | Existing global two-instance concurrency; 12 starts per UTC day; 120 seconds per instance; 15 seconds per command; no Internet; 16 KiB output |
| Time window | 90 minutes from preparation; admission and spending grants expire; cleanup still allowed afterward |
| HTTP | At most 2,000 admitted diagnostic/public action requests; public generated execution keeps existing platform limits |
| Model | Existing Runpod `kimi-k2.6`, thinking disabled, at most 6,000 output tokens per call |
| Model spending | One shared durable ledger reserves US$0.275 before each dispatch, up to US$13 across both owners; reservations stay charged even after a lost reply |
| Infrastructure | US$2 allowance; bounded instance duration, starts, requests and cleanup provide a conservative estimate, not an account-wide billing cap |
| Cleanup owner | Driver `finally` block discovers the recorded resources, stops workspaces, deletes its Container application and Worker, then verifies Worker/application/namespaces absent |

At the prices checked on 6 October, Kimi K2.6 costs **US$0.95 per million input tokens and US$4 per million output tokens**. The reservation covers a conservative 262,144 input tokens plus 6,000 output tokens (US$0.273037 before rounding up). Actual requests should use less. Report returned token usage separately; unknown responses retain the full reservation. [Runpod pricing](https://docs.runpod.io/public-endpoints/models/moonshot-kimi).

Cloudflare bills active instances for memory, CPU and disk. The existing `lite` instance has 256 MiB memory, 1/16 vCPU and 2 GB disk. Even a batch crossing UTC midnight is constrained by the existing daily workspace allowance; record actual starts and destruction evidence. Request/storage/hosting charges and existing account activity are separate from the model estimate. Do not describe this harness as an account-wide dollar cap. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/), [instance limits](https://developers.cloudflare.com/containers/platform/limits/).

No new goal-wide model-turn ceiling is introduced. Default daily account capacity remains enforced. A capacity/permission wait leaves the goal saved; a diagnostic that stops at that point has not passed the milestone. The separately approved isolated-test policy below permits continuation under the same dollar budget without changing production capacity.

## Actual run and repair — 6 October 2026

The approved deployment began at **19:46:58 UTC**. Dinner reached its first planning request, which returned Runpod HTTP 500 without token usage. The task reported `provider_unavailable`. No workshop ran, service was generated or component was saved; camera never started.

Cleanup was verified at **19:47:34 UTC**. Worker/Container name: `restyle-workspace-proof-d15104867c0daf6485ad7750`. The Container application and all six namespaces were verified absent, as was the Worker; the local deployment secret file was deleted. Namespace IDs:

```text
35abae26ad884f96a9829c30338ce4e1
01415a9ff4174b7099c3569bc67489b4
ba485a620ee44597b0033d143f2d3e70
dccdc9c743c8435aa1530eda34498b2e
96895a9a2bab4560995dea04b2b0cd1a
5a99b4b46c55438e8418dd85c3e28054
```

The private receipt is `.wrangler/cloud-agent-infrastructure/workspace-bb37Ww/report.json`; its `modelDiagnostics` also records the subsequent model-only investigation. No replacement deployment was made. Missing this private file on another machine does not justify recreating the resources.

| Observation | Evidence / consequence |
| --- | --- |
| Original planning format | Exact `json_schema` request failed both from the Worker and directly. Adding a root object type or replacing `const` with `enum` also returned HTTP 500. A tiny schema succeeded; this is not evidence that all structured output is unsupported. |
| Corrected Runpod format | `json_object`, with the complete authoritative schema in a trusted system message, returned HTTP 200 and asked how many seats the dinner table has. Thinking remains disabled; a separate tiny request without that setting failed. These observations do not establish a provider-wide outage. |
| Acceptance authority | Native, task, builder and attachment validators still reject malformed replies, fabricated readiness/receipts/ownership and wrong-stage tools. The configured provider does not change and there is no automatic wire-format fallback. |
| Diagnostic replay correction | A post-reservation task snapshot initially caused the diagnostic's question validation to reject valid output. The product runner passes its pre-reservation claimed task. Reconstructing that local claim and replaying the unchanged live response through the actual planner passed, with no extra paid call or product-state mutation. This was diagnostic setup, not a product planner defect. |
| Recorded usage | **10** total model requests: five HTTP 500 with unknown usage and five HTTP 200. Reported successes total **2,863 input / 114 output tokens**, estimated **US$0.003178** at the cited rates. Conservative reservations retain **US$2.75** across all ten calls, including unknown responses. Neither figure is an invoice. Cloud diagnostic admission count: **5**; workshop starts: **0**. |

The [Runpod adapter](../../server/assistant/native/runpod.js) now uses the successful JSON format. [Regression coverage](../../tests/first-release/model-planning.test.mjs) exercises the actual adapter and all three saved planners' validation boundaries; native editing, image evidence, cancellation, truncation and credential protection remain covered by the existing provider suite. Read progress for final check and delivery results.

**The first one-deployment authorization is consumed.** The separately approved replacement is recorded below. Do not interpret the unused dollar ceiling as approval for an unspecified additional deployment. Keep both failed evidence and the original 1F checkboxes.

## First replacement — consumed and cleaned up

The corrected driver is prepared for **one replacement deployment, up to US$10: US$8 model reservations plus US$2 infrastructure allowance**, with the same two goals, resource count, 90-minute window, admission controls and verified deletion. The user approved this replacement by saying “yeah just finish 1f” after the reduced plan was explained. This replacement ran at 20:32 UTC and is now removed, as recorded below. That run used the reduced allowance.

This fits the original US$15 ceiling conservatively: retain **US$2.75** for all previous model requests and the entire previous **US$2 infrastructure allowance**, then reserve **US$10** for the replacement, totaling **US$14.75**. This is planning allowance, not billed spend or an account-wide cap. This permission is recorded; do not ask again for the same replacement. The prepared driver now keeps this same deployment alive for the browser, recovery and viewer matrix below.

## Replacement result — 6 October 2026, 20:32 UTC

Worker/Container `restyle-workspace-proof-854d81016dde0c96a0ead5ee` started at **20:32:12 UTC**. All three model calls returned HTTP 200. The actual editor saved the dinner task, closed, and the agent saved the supplied two-seat answer. The builder unnecessarily asked to confirm that answer. The diagnostic driver allowed only one question and failed its own assertion; it automatically removed the deployment before source generation. This was a harness defect, not a provider outage or evidence that saved questions cannot work.

Cleanup was verified at **20:32:50.848 UTC**. Worker, Container application `9f12a3b1d31d4e90b78027859dbc44f4`, all six namespaces and the deployment secret file were removed. Namespace IDs: `9f12a3b1d31d4e90b78027859dbc44f4`, `056f565ed462419a86f89321c1c12cb4`, `81144bafd2ba445aa2fa16837bde858f`, `fb7a735ebe954e7c865203e6330e8e83`, `c5c53c7008734be6a978266dbb96ba8a`, `978ce5633cc042a0bee5780202e870c9`. Private journal `.wrangler/cloud-agent-infrastructure/workspace-3FriK2/report.json`; log `/tmp/restyle-1f-complete-live.log`. Eleven admitted diagnostic requests; zero workshop sessions or hosted services. Reported usage: **4,654 input / 97 output tokens**, estimated **US$0.004811** after per-call rounding; conservative reservations **US$0.825**.

The repaired driver saves every additional question and waits for a local reviewed answer tied to the exact task/question/revision, keeping the deployment within its existing deadline. Two regression tests verify a second question can wait and continue the same task, and stale answers are rejected. Builder instructions now explicitly use saved answers when the original request calls that information unknown. No arbitrary per-goal question/model limit is added.

## Next corrected run — approved

**Approved capacity adjustment, 6 October:** the user answered “Use the approved dollar budget” after the same dinner task paused at the existing 20-call daily allowance. For this one existing deployment, `PROOF_SPENDING_POLICY=settled-usage` enables a diagnostic-only daily allowance up to the existing 4,096-entry reservation-storage bound. The 12/minute burst limit, exact replay accounting, original 90-minute expiry, US$7.50 model allowance and US$2 infrastructure allowance remain. Every model call first reserves US$0.275; a returned valid usage report settles its estimated token cost, while missing/unknown usage retains the entire reservation. Existing counts and the spending ledger survive this same-resource update. Product default capacity is unchanged. Four SQLite/restart/budget tests passed; no additional deployment is authorized by this adjustment.

Prepared scope: **one further disposable deployment, up to US$9.50**, consisting of **US$7.50 model reservations and US$2 infrastructure allowance**, with the same two goals, resources, 90-minute expiry and verified deletion. The user approved this concrete run by saying “continue until finished” after its US$9.50 scope was explained. The two earlier deployments are removed. Do not ask again for this same approved run.

Across both finished runs and model diagnosis, five HTTP-500 calls retain their full **US$1.375** unknown-usage reservation. All eight successful calls reported usage, estimated **US$0.007989** in total. Retaining both earlier US$2 infrastructure allowances and adding this US$9.50 proposal gives **US$14.882989**, within the original US$15 total. This uses returned usage to settle known successful calls; unknown calls remain fully reserved. It remains an estimate, not an invoice or an account-wide billing cap.

## Corrected run outcome — 6 October, cleanup verified

The US$9.50 corrected run ran from **21:21:50.444 to 21:59:54.744 UTC**. Worker/Container `restyle-workspace-proof-351ca14c55ee303131312f13` and all six namespaces were deleted, absence verified, and the deployment secret file removed. Private journal `.wrangler/cloud-agent-infrastructure/workspace-jW2ZkA/report.json`; log `/tmp/restyle-1f-corrected-live.log`. Application ID `6c17043fd74f4afd80692be2a2aa1104`; namespaces `6c17043fd74f4afd80692be2a2aa1104`, `4fc1ad784c584a77ad61425ffc5a0ca6`, `b0d3bdcf615f4215b2b120743505e924`, `3c95983c14d94f1a9087dd27e007ee74`, `6fb5a6360961470a8e3e01c854fc3d64`, `264b2238fcf84393a48bda60aff5d6f1`.

**Partial successes:** real editor task creation and browser closure; saved dinner clarification; actual model-generated JavaScript and Node tests; injected startup exception observed with exit 1; model repaired its source; **4/4 generated tests passed**; independent frozen-agreement checks passed; failed initial hosting reconciled absent, subsequent hosted release recovered. The task reached component attachment. Its form proposal failed compilation because it used JavaScript object syntax and concatenation inside a PVO JSON request. The component did not become Ready; equipment, viewer, delivery and local-removal checks did not run. All 1F tasks remain unchecked.

The test ended on **HTTP 503 while submitting the reviewed attachment-repair answer after a same-Worker update**. The driver asserted 200 and immediately cleaned up. The original server exception was not retained, so a temporary update error is a hypothesis, not a proved cause. The repaired diagnostic transport retries only reads and exact idempotent intents, preserving answer/creation IDs and input. Restart, Resume, unrecognized writes and permanent rejections are not blindly replayed. Retry logs retain path/status/attempt without secrets; cancellation and the original expiry still apply. Three new tests cover lost committed answers, failed reads, immutable request replay, effect boundaries and expiry. A full compiler-checked request example was also added to the attachment planner; **12 attachment/planner tests passed**.

**Usage:** **76 HTTP-200 model calls**, all with returned usage; **571,799 input / 21,117 output tokens**, estimated **US$0.627714**. No unknown model responses in this run. **535** admitted diagnostic HTTP requests. This is a token estimate, not an invoice. Existing workshop session/time and service limits remained enforced. The private snapshots preserve source, command receipts and validation reports; deleted resources must not be recreated merely to replace this evidence.

## Recovery run — consumed and cleaned up

One new disposable deployment, **up to US$6.75**: US$4.75 for metered model usage and US$2 infrastructure, two requested demonstrations, the same six namespaces/one Container, 90-minute deadline and verified deletion. Known usage settles actual reported token estimates; unknown outcomes keep US$0.275 reserved. The previously approved diagnostic capacity policy is explicit from startup. The driver now recovers temporary read and idempotent-answer failures instead of deleting the test immediately.

Across all completed runs, retain **US$6** for the three infrastructure allowances, **US$1.375** for five earlier unknown model calls, and **US$0.635703** for all known model usage. Adding this US$6.75 proposal gives a conservative **US$14.760703** total, inside the original US$15. The user approved this replacement by answering “Approve remaining US$6.75”. This authorizes one replacement deployment; do not ask again for this same run. No additional key entry is needed.

## Startup outcome — 6 October, cleanup verified

The approved US$6.75 deployment ran from **22:09:50.584 to 22:11:00.220 UTC**. Its private startup endpoint returned 503 and never became ready within the driver's thirty-second readiness window. **Zero model calls, zero generated tasks, zero workshop starts and zero hosted releases.** The ledger recorded ten admitted diagnostic requests. The underlying startup exception was not retained; neither a provider outage nor a specific code defect is established. Local reproduction of the exact health route succeeds.

Worker/Container `restyle-workspace-proof-d758435100daa3b4d36f2728`, application `b7be8a067aa044d58dfd1c4744fe6525` and all six namespaces were deleted and absence verified. Namespace IDs: `b7be8a067aa044d58dfd1c4744fe6525`, `dbb7300eabf444e99ab4ce9ac83e8cb3`, `48471104f5a4468a90d4844de5da09a6`, `15a83f5ff9b4478c9864c805b46b5613`, `0fe30bc2661648fc88f97f957c576b89`, `82421e67b7fb4027abd6fb8df8de7b62`. The deployment secret file was removed. Private receipt `.wrangler/cloud-agent-infrastructure/workspace-Lvojiy/report.json`; log `/tmp/restyle-1f-recovery-live.log`. This consumed deployment must not be restarted.

The corrected driver now includes startup in its existing read-only recovery loop and original ninety-minute deadline, allowing diagnosis and updates of that same resource. Authenticated startup failures identify the failing phase and retain bounded platform error text after removing configured credentials. Other request/provider failures do not expose arbitrary error text. No source, test or ownership gate is weakened. Local tests cover the actual health endpoint, unauthorized access, credential redaction, recovery after the former thirty-second cutoff, wrong-resource rejection and original deadline/cancellation. This fixes the lost-diagnosis and premature-cleanup defects; **the cloud startup cause remains unknown**.

## Continued 1F recovery — authorized to completion

The user explicitly instructed: **“continue working until done … remove the 15$ ceil complete 1f until it all pass.”** This supersedes the former US$15 aggregate ceiling, pending US$4.75 approval and one-deployment restriction. Necessary replacement runs and same-resource repairs for **1F** are authorized without repeated approval. This does not authorize unrelated milestones or bypass tests, ownership controls or release protection.

Begin with the already tested US$2.75 model admission allowance plus US$2 infrastructure estimate as an operational batch setting. These are not a new user spending ceiling or a reason to ask again; adjust diagnostic admission as needed to finish 1F, record every change and actual usage, and keep production capacity unchanged. Each disposable run retains its ninety-minute cleanup deadline, bounded individual calls, six namespaces/one application and resource inventory. Reuse a running resource for repair wherever possible. Clean up completed or failed runs and verify absence before replacement. The Runpod key is already configured.

Historical spend evidence remains above: four infrastructure allowances of US$2 each, five unknown model calls retaining US$1.375, and US$0.635703 of known token usage. These are estimates/reservations, not invoices. Removing the overall ceiling does not remove metering or cleanup.

## Active completion run — dinner delivery passed

Run `06ef187e5cb8af49267a5f0f` began **22:38:12.162 UTC** and passed startup. It uses Worker/Container `restyle-workspace-proof-06ef187e5cb8af49267a5f0f`; journal `workspace-ZmaGwt/report.json`. Cleanup completed at **2026-10-06T22:59:16.765Z**, with all cloud resources absent and local deployment secrets removed. Its six namespaces are `bd115243de5c4c7891d15013452b4f6c`, `f7aded9ac02a4f73ae6624cfda035deb`, `8d045892d27b47c78bd078b4a688e486`, `337706706ee641de8c6222660d654d89`, `88c6253b4ee3464db030a46bd9010a45`, `6db6ecf0ab124f7788712c08bae862ab`; the first is also the Container application ID.

**Verified at 22:48 UTC: 1F.04 and 1F.06.** Dinner task `o2XfoIDMWjjT9hObGCuhfQ` produced a connected form after nine generated Node tests and independent frozen-agreement validation passed. The full actual editor/Try/export/viewer/removal journey passed: lost activation response plus authoring restart; identical prepared-file retry; failed publication upload then exact-byte retry; separate cookie-free downloaded and published viewers with creator closed/workshops absent; one accepted and one full response for concurrent last-seat requests; exact action replay and a new same-name duplicate; retained hosted service, records and management/Undo explanation after deleting the local component. Publication storage remains the declared fixture; hosted execution and records are real cloud resources. Camera subsequently hit a 45-second model timeout before completing its agreement; the driver ended this run. 1F.01/05 remain unchecked. The next run uses only camera, preserving this dinner evidence.

The builder repeated passing tests until it reached the default twelve daily workshop sessions. Commit `79c949b` presents the last executed decision followed by that batch's actual results within the existing prompt bound. After this same-resource update and Resume, it advanced through independent review and hosting. Under the explicit completion authorization, diagnostic daily workshop admission is now 4,096 (existing storage bound); two concurrent workshops, leases, tombstones, original expiry and metering remain, and production default twelve/day is unchanged. A separate private `completion-policy-change.json` records the amendment without racing the running driver's journal. Thirteen focused regressions and all 1,481 full tests pass. The old intentionally lost-hosting-reply flag is not recorded; do not claim that particular injection ran. Actual interrupted activation/export and authoring restart are recorded.

The completed fifth run recorded **53 model calls**, 52 known HTTP 200 responses estimated at **US$0.457361**, one unknown response reserved at US$0.275, and 488 admitted diagnostic HTTP requests. Runner recovery now explicitly resumes retryable inference failures while retaining task identity; Stop remains terminal. Twelve focused regressions pass, including actual local account routes/SQLite Stop and uncertain Resume recovery. The camera-only runner also restarts authoring after saved source, then requires the same task to finish. These runner checks are not yet live-camera acceptance evidence.


### 7 October — newly deployed address propagation

Camera-only run `790268ad4e8badd432336362` (`workspace-i92vUH/report.json`) ran **2026-10-06T23:07:06.877Z–23:07:30.989Z**. It ended before creating a task because the new address did not return the required application identity/readiness; subsequent diagnostic cleanup request returned unmarked HTTP 404. No model/workshop/task was started by the runner. Usage was unavailable. Worker, one application and all six namespaces were removed with verified absence; secrets removed. This is a startup diagnostic failure, not failed camera behavior.

Readiness now waits for an unmarked platform 404 under the same run deadline. Wrong application identity, authentication errors and marked application errors still fail. Five transport regressions pass in `/tmp/restyle-1f-route-propagation-tests.log`. Continue with a fresh camera-only journal under the user's existing completion authorization; do not revive a consumed resource.

### 7 October — browser preflight recovery

Run `1710621093ac99bbcc783fb4` (`workspace-aIE6Oo/report.json`) ran **2026-10-06T23:08:28.332Z–23:09:25.995Z**. Cloud readiness passed; editor startup probe timed out before creating a task. **Zero model calls, two diagnostic HTTP admissions**. All resources and secrets removed with verified cleanup. The ordinary UI had loaded, but the probe imported an unversioned storage module while the hot-reloaded app used timestamped modules. Its separate instance remained in `starting`. Restarting only the owned Vite 5318 process cleared the split; the actual local browser/task-creation preflight passed all three tests in `/tmp/restyle-1f-camera-browser-preflight-fixed.log`. Added diagnostic storage/error recording for future startup failures; no product persistence change.

Before a paid browser acceptance run, start a fresh isolated Vite process after source changes and verify `CHECK_ACCEPTANCE_BROWSER=1 node --test tests/first-release/acceptance.test.mjs`. Do not restart the user's beta server. All seven diagnostics are cleaned; subsequent run remains authorized by the completion instruction.

### 7 October — cloud submission diagnosis

Run `1c47fd9fd5a361e2943e514e` (`workspace-H0uUcC/report.json`) ran **2026-10-06T23:11:47.529Z–23:12:38.942Z**. The fresh editor passed storage startup, but the later saved-task submission wait expired. Zero model calls, three admitted diagnostic HTTP requests, no workshops; complete cleanup verified. Cause remains unconfirmed. Private diagnostics now record rejected API status and the submission stage. Transport now recognizes inner API-wrapper HTTP failures for the same replay-safe intents; six transport regressions pass. Read-only account-route readiness precedes browser startup. The fresh local browser preflight passed again in `/tmp/restyle-1f-camera-browser-preflight-second.log`.

## Run and recover

Invocation from the active checkout, under the recorded completion authorization:

```sh
node scripts/checks/cloud-agent-first-release/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run-approved-1f --scenario=equipment
```

Use privately supplied `RUNPOD_API_KEY` or a nonempty `apikey` in the Runpod CLI configuration. The script never prints the key. A file existing is not sufficient: the first approved launch found an empty key and stopped before any resource creation or charge. On this Mac, the user can enter it privately with:

```sh
node scripts/checks/cloud-agent-first-release/configure-key.mjs
```

This opens a hidden-entry dialog and saves the CLI setting with owner-only permissions. Never paste a key into chat or commit it. The user approved this secure entry step and saved the key on 6 October. Cloudflare uses existing Wrangler authentication. The actual run and model-only checks above now establish that the key can reach the configured endpoint.

The private `.wrangler/cloud-agent-infrastructure/workspace-*/report.json` is written before resource creation. It includes names, limits, task revisions, generated source/agreement/test results, service identities, usage and cleanup. Secret files are separate and are deleted after verified cleanup. If interrupted, inspect that journal before any new run; do not create a replacement deployment while cleanup is unresolved. Recover from the same checkout with:

```sh
node scripts/checks/cloud-agent-first-release/cleanup.mjs 84880ccf8f98bb789d58cbea5436a645 .wrangler/cloud-agent-infrastructure/workspace-REPLACE/report.json
```

Use the exact recorded journal path. Recovery cannot deploy or create a resource. It verifies the account, random owned names and private paths, reconciles provider records, and preserves credentials only when cleanup is unresolved.

The driver starts real saved tasks from the editor, closes the creator during authoring, applies the saved result after reopening, runs Try, exports with a lost activation reply, retries an interrupted publication upload, and loads the downloaded/uploaded bytes in a separate viewer. Local reviewed input files select form values and expected outcomes after inspecting the actual generated contract; they cannot replace generated code. The same deployment remains under its original expiry and allowance. The live authoring run may expose generation or provider defects; preserve the failed evidence and fix the actual issue rather than inserting a prepared program.

## Local review files for the continuing agent

Start the isolated editor first: `node_modules/.bin/vite --config editor/vite.config.ts --host 127.0.0.1 --port 5318 --strictPort`. The driver checks this address before preparing any resource. Do not use the production/beta server as this diagnostic source.

The private journal names a local file when the driver waits for an additional answer. Inspect the saved question and original scenario. Resolve it from the already approved scenario when possible; ask the user only for genuinely missing information. Write the exact task/question/revision from that checkpoint with a plain answer, for example:

```json
{"taskId":"ID_FROM_JOURNAL","questionId":"question-2","questionRevision":0,"value":"Use exactly two seats, as already specified."}
```

The driver refuses a stale identity and resumes the same task. It waits only within the existing approved expiry; waiting does not grant extra time or spending.

After each task reaches ready, inspect its real generated agreement, source and component fields, then write the journal's `dinner-inputs.json` or `equipment-inputs.json`. The object requires `resultPath` (array of result keys, or empty for a primitive), `testFields`, `viewerFields`, `publishedFields`, `publishedExpected`, `accepted`, `rejected`, `cases` (objects with `input`, `expected`, optional HTTP `status`), and exactly two `raceInputs`. These are test inputs and expectations, never replacement generated source. Dinner must leave one seat for two distinct competing guests; camera must check invalid/overlapping/adjacent dates and then two competing requests for a free interval. The published form must submit a fresh rejected request after capacity is full or an interval occupied, so repeating it with a new action after local removal verifies retained records. Do not choose expectations that excuse incorrect generated behavior.

## Diagnostic fixtures and deliberate failures

The editor uses two synthetic account sessions and a controlled foreground handoff. Actual saved planning, agreement, generated source, independent validation, hosting and attachment use the configured model and cloud provider. The private bridge signs diagnostic sessions and calls production task/service routes; it does not use the production login database. Publication storage is controlled: normal export UI uploads exact PVO bytes, and the real published player loads those bytes while calling the real hosted service. This proves delivery integration, not production R2 availability.

For dinner only, the harness appends a declared startup error to the first model-written service module. The generated tests remain unchanged; the model must repair the error using actual tool feedback. It then injects a hosting failure before dispatch, and on a subsequent real successful publication restarts the authoring worker before its receipt is saved. These faults are private test adapters, not production behavior. Evidence must show repair and reconciliation, not just injection.

Stop is terminal in the current contract. Its cancellation behavior is checked separately from Resume of a retryable failure; this milestone does not promise that a stopped goal can be revived. The published-viewer, capacity/overlap races, cross-owner access, test/live authority and local-removal assertions use the generated service contract.

## Remaining acceptance matrix

These are evidence requirements, not a second set of completion checkboxes. Update the original numbered roadmap only after verification.

| Roadmap ID | Required evidence still to collect |
| --- | --- |
| 1F.01 | Both ordinary requests generate code, pass independent cases and return usable connected components with the real configured model/provider |
| 1F.02 | Necessary question/answer, Stop/resume, an invalid program rejected by actual tests and a model repair driven by that feedback; identify deliberate fault injection if used |
| 1F.03 | Close creator during work, restart authoring worker, recover saved progress and external effects without a duplicate deployment |
| 1F.04 | **Passed for generated dinner:** workshops absent, creator closed, separate cookie-free downloaded/published viewers used the real hosted service |
| 1F.05 | Exact retry and distinct simultaneous last-seat/overlap submissions; wrong owner, test/live separation, failed hosting and interrupted export |
| 1F.06 | **Passed for generated dinner:** local removal retained the manageable live service and records; actual UI showed the correct Undo explanation |
| 1F.07 | Actual model tokens/unknown calls, workshop sessions, service calls, configured limits, dated cost estimate and verified deletion of every diagnostic resource |
| 1F.08 | Relevant source/types/browser/provider checks, actual combined beta delivery and authorized normal release promotion; preserve the user's exclusion of GitHub Actions polling |

The existing controlled browser checks remain useful regression coverage. They cannot substitute for the real-model/provider evidence above. No task becomes complete merely because this plan or a runnable harness exists.
