# 1F: prove the complete journey

[Roadmap 1](restyle-cloud-agent-roadmaps/01-first-working-component.md#1f-verify-the-complete-first-release) · [Progress](restyle-cloud-agent-progress.md) · [Handoff](restyle-cloud-agent-handoff.md)

## In plain English

The earlier steps built the parts. This milestone asks the real AI to put them together twice: a dinner RSVP with limited seats, and a camera booking form that prevents overlapping bookings.

The temporary workshop writes and tests the code. The separately hosted service keeps the saved RSVPs or bookings and answers viewers after the workshop stops. Publishing makes that checked service available to its connected component; it does not share a plugin or install something for other creators.

**Status, 6 October 2026:** both approved diagnostic deployments are removed. The first exposed a model request-format issue, now repaired; the replacement reached the actual model but exposed the driver’s one-question assumption, also repaired locally. Neither demonstration reached generated source. All 1F tasks remain unchecked. One further corrected run is prepared, awaiting approval. This is no public product deployment; beta delivery is recorded separately in progress.

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

No new goal-wide model-turn ceiling is introduced. Existing daily account capacity remains enforced. A capacity/permission wait leaves the goal saved; a diagnostic that stops at that point has not passed the milestone. Do not bypass the capacity control to make a demonstration pass.

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

## Next corrected run — awaiting approval

Prepared scope: **one further disposable deployment, up to US$9.50**, consisting of **US$7.50 model reservations and US$2 infrastructure allowance**, with the same two goals, resources, 90-minute expiry and verified deletion. This is not approved yet: the prior approvals each covered one deployment, and both deployments are removed. Do not execute until the user approves this concrete run.

Across both finished runs and model diagnosis, five HTTP-500 calls retain their full **US$1.375** unknown-usage reservation. All eight successful calls reported usage, estimated **US$0.007989** in total. Retaining both earlier US$2 infrastructure allowances and adding this US$9.50 proposal gives **US$14.882989**, within the original US$15 total. This uses returned usage to settle known successful calls; unknown calls remain fully reserved. It remains an estimate, not an invoice or an account-wide billing cap.

## Run and recover

Prepared invocation, from the active checkout; **only after approval of the next corrected run**:

```sh
node scripts/checks/cloud-agent-first-release/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run-approved-9-50-usd
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
| 1F.04 | Workshop absent, creator closed, separate viewer uses downloaded and published component against the hosted service |
| 1F.05 | Exact retry and distinct simultaneous last-seat/overlap submissions; wrong owner, test/live separation, failed hosting and interrupted export |
| 1F.06 | Remove the local component while the owned service remains manageable; Undo explanation accurately distinguishes local edits from saved viewer records |
| 1F.07 | Actual model tokens/unknown calls, workshop sessions, service calls, configured limits, dated cost estimate and verified deletion of every diagnostic resource |
| 1F.08 | Relevant source/types/browser/provider checks, actual combined beta delivery and authorized normal release promotion; preserve the user's exclusion of GitHub Actions polling |

The existing controlled browser checks remain useful regression coverage. They cannot substitute for the real-model/provider evidence above. No task becomes complete merely because this plan or a runnable harness exists.
