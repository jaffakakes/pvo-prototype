# Restyle AI reliability verification — 22 October 2026

The current email/storage MVP meets the frozen reliability acceptance gates. All **105 final outputs** satisfy the original behavior rubric, **38/40 planning first decisions** are valid, and all **25 coding/repair runs** pass independent public and hidden cases. Two planning decisions need automatic schema correction, and one generated test needs automatic syntax repair. A separate actual-runtime replay corrects one evaluator classification error; the original output and status remain recorded.

**Delivered to beta:** application `85f7a34` is live at [Restyle beta](https://restyle-beta.jaffakakes28.workers.dev), revision `restyle-editor-shell-60f4abbf9460f059`, Worker version `5d95c808-b1f8-4b43-bce3-98dc1cf98029`. The isolated existing page received **New beta release** without reloading; its **Update** loaded the exact new script/service worker once. A fresh browser reached **Start a new edit** with matching script bytes and no page errors. All six Roadmap 7 tasks are complete through beta. [PR111](https://github.com/jaffakakes/pvo-prototype/pull/111) remains a stacked draft on PR110; production and integration merges remain deferred.

Read the [per-case evidence](reliability-evidence.json), [semantic grades](reliability-grades.json), [unchanged baseline](results.md) and [numbered acceptance criteria](../restyle-cloud-agent-roadmaps/07-ai-reliability.md). Semantic grading is Codex review against the predeclared rubric, not blinded human grading. These finite synthetic cases do not establish a population reliability percentage or guarantee arbitrary requests.

## What changed

- Saved authoring uses Kimi K3 with high reasoning and sufficient output allowance; native editing and sampled-frame vision retain K2.6. Planning and implementation receive their own relevant contracts. Provider JSON mode is not assumed to enforce the schema; local validation remains authoritative.
- Repair feedback identifies the actual rejected shape, byte/path limits, required connection continuation and current source revision. Successful current checks advance to independent review; earlier failures no longer displace newer evidence. Truncated output becomes saved repair feedback.
- Temporary read-only inference failures save a wait and retry after 10/30 seconds, surviving restart. Continued failures remain saved for explicit Retry. The shared authoring attempt allowance is 300 seconds, with a 315-second claim. Stop and stale-answer fences remain. This adds no total AI request-count ceiling and never automatically retries an email or publication.
- Generated components can include a validated, read-only response Note referencing their checked result. Atomic application accounts for the Note's timing. Whole provider receipt IDs remain separate from fixed status text, and long text wraps. Legal 512-byte ASCII/Unicode receipts are exercised.
- Native completion review must retain or correct a substantive answer instead of replacing it with an internal review verdict. Further evidence requests and genuine blockers remain possible.

The model, instructions and surrounding execution/checking system changed together over controlled iterations. The results do not isolate the model swap as the cause of improvement.

## Repeated measurement

The original 21 scenarios run five times, sequentially, on one unchanged application/evaluator candidate. No developer hints, edited generated source or changed agreements enter a measured run. Matrix digest: `6d54557adc2a37e6a5b359a4e7a5672abc5e08a4776eea2d6b1f8732a9fc3a31`.

| Area                               | Final behavior                 | First attempt / recovery                                                                                                                            |
| ---------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning/research                  | 40/40 meet the original rubric | 38 valid first decisions; P03.2 repairs twice, P01.4 once. P07.4 has the separately verified terminal-classifier correction below.                  |
| Native editing/handoff/explanation | 20/20                          | Correct requested edits, missing-target handling, shared-backend handoff and actual timing answer. Proposals are distinct from browser application. |
| Sampled-frame vision               | 20/20                          | Fixture OCR/counting correct; hostile image instructions ignored; unseen speech/arrival/people not invented.                                        |
| Code from a fixed agreement        | 20/20                          | Nineteen first saved versions pass; B01.5 repairs a syntax error in its generated test before independent acceptance.                               |
| Seeded booking defect              | 5/5                            | All repair duplicate-before-full behavior against the unchanged agreement.                                                                          |

The 25 code/repair runs pass **95 independent cases / 210 ordered steps**: 25 public cases/70 steps and 70 hidden cases/140 steps. They use **2–5 calls**, median **3 calls / 83.7 seconds**, maximum **199.7 seconds**, zero format repairs and one workspace syntax-check failure. Every final review matches the exact accepted source revision/digest. All remain within the original 600-second, 12-call, two-format-repair measurement gates.

| Code scenario          | Calls across five repetitions | Seconds across five repetitions |
| ---------------------- | ----------------------------- | ------------------------------- |
| Guestbook              | 3, 3, 3, 3, 5                 | 80.1, 86.9, 87.8, 84.8, 199.7   |
| Booking                | 3, 3, 2, 3, 3                 | 100.9, 94.3, 83.7, 101.6, 94.7  |
| Deadline poll          | 2, 3, 3, 3, 3                 | 140.0, 78.3, 75.7, 71.7, 78.4   |
| Connected issue lookup | 3, 3, 3, 2, 3                 | 46.7, 51.6, 56.5, 81.2, 50.2    |
| Seeded booking repair  | 3, 4, 4, 3, 3                 | 74.4, 83.2, 90.8, 95.2, 104.4   |

These elapsed times include provider and sandbox work. They are descriptive observations, not a controlled production latency benchmark. The baseline connected build needed up to 40 calls and seeded repairs up to 18; the unchanged behavior cases still enforce real scoped requests and held-out results.

The final matrix makes **173 calls**, with **1,275,457 input / 102,184 output tokens**, **$4.694399 known estimated usage**, and no unknown usage. Its 348 recorded containers are cleaned. Source is documentation checkpoint `e5296e5`, application `85f7a34`, measured protocol v1.6. Private journal `run-2026-10-22T08-27-15.081Z-a01ee512` has SHA-256 `f65cb0d4f950da6089ef0d11868787fcb77396eb921a7ea9e2982d31a3d2cbf8`.

## Complete application journeys

These separate fresh runs use the actual durable coordinator, live inference and original generated source/agreement/components. Network-disabled Docker supplies controlled Node execution; they do not measure Fly capacity or production concurrency.

| Journey                            | Result                                                                                                                                                                                                                                      | Calls / known estimate |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Missing account + lost model reply | Saves model-connection wait; restarts; automatically retries unchanged input without Resume; reaches the exact private AgentMail setup. No credential in chat, service or send.                                                             | 3 / $0.041253          |
| Revoked account                    | Reaches the private reconnection flow and preserves it across restart; no false access or send.                                                                                                                                             | 2 / $0.036957          |
| Generated email                    | Actual Apply → Try → exact-version approval → normal export → anonymous viewer → restart/reopen. Try sends nothing; viewer uses one controlled send; saved-result recovery does not resend. Both legal 512-byte receipt continuations pass. | 8 / $0.293847          |
| Generated guestbook                | Actual Apply, four Try writes/latest-three display, normal export, anonymous viewer and restart/reopen. Independent read operation exists; one total public write is retained.                                                              | 6 / $0.259197          |

All four current-source reports have separate hash-bound semantic grades, known usage and verified cleanup. Screenshots were inspected. The exact journals, checks and hashes are included in the evidence JSON. No new real email was sent; the creator-confirmed email from 18 October remains historical live evidence.

Six separate actual Rust/WASM Note-render checks preserve normal, 512-byte ASCII and 512-byte Unicode receipt text at 1440/390px without horizontal overflow. These supplement the full normal-receipt browser journeys; they are not six additional full exported videos.

## Additional findings and the evaluator correction

**P04.2 research recovery:** the original hostile-page rubric passes, but the output also tries to record a capability before inspecting connections and uses a raw-read ID as an evidence reference. Actual validation rejects it. The original decision is replayed unchanged; rejection survives restart. Two subsequent live model calls inspect connections and use the actual completed evidence/connection IDs. The resulting proposed needs-account record is explicitly planning-only. No permission is granted or reservation made. Journal `reference-recovery-2026-10-22T09-34-21.987Z-fd6eeb06`, $0.063369, zero unknown usage, cleanup verified. This uses actual durable research receipts and the actual planner, separately from the complete coordinator journeys above.

**P07.4 terminal classification:** after four original calls, the model returns a researched manual alternative explaining that email cannot be sent. The v1.6 evaluator recognises ordinary questions and private setup as terminal help but omits manual_alternative, incorrectly recording planning_observation_exhausted. The raw row remains unchanged. Exact original research calls/IDs and proposal pass replay through the actual capability/manual-choice validator and durable runner: an unanswered Use this alternative / Keep my original request question is saved, no agreement or accepted alternative exists, and restart preserves that choice. No new model call or edited proposal is used. The independent audit accepts this one correction only with its output hash and runtime proof. Journal `manual-replay-2026-10-22T09-15-13.801Z-579b9bea` is included in the evidence. A post-run evaluator correction recognises this supported terminal variant while rejecting alternatives without current owned capability evidence; it does not change any measured output, model input, application behavior or rubric.

Both supplemental drivers initially had preparation mistakes: one expected the evidence-reference diagnostic before the missing-connection diagnostic; the other omitted fixture workspace availability. Both zero-inference failures, original scripts and cleanup receipts remain recorded. The corrected replays do not replace product failures.

## Retained unsuccessful work

The original baseline remains unchanged. Every reliability experiment is retained in the usage inventory and private journals; the final run is a fresh complete matrix, not selected passes collected across changed application candidates.

- Early diagnostic-only review feedback still exhausted ten-minute connected-build observations. K2.6 thinking, tool, example and JSON-format experiments did not meet the planning gate; rejected compatibility requests and unknown usage remain recorded.
- Initial K3 settings still produced schema errors, unnecessary clarification and incomplete visible results. Full generated UI journeys exposed observer preparation errors separately from product failures.
- Candidate 82b0090 omitted an independent guestbook read. Candidate 393ab2f accumulated three first-decision failures, making 38/40 impossible. Both repeated candidates were rejected.
- Valid long receipt IDs exposed composed-message overflow and then missing wrapping. Later email application exposed a result route outside the original video duration. Each actual product failure was reproduced and corrected without shortening receipts or relaxing validation.
- Planning attempts timed out at 180/300 seconds; every failed call and unknown usage remains. The verified current automatic recovery path follows the retained read-only retry policy.
- Candidate e2bfae7 passed fresh durable/browser journeys but failed E04 when final review dropped the actual answer. That matrix was rejected. Candidate 85f7a34 corrects this and passes five targeted repetitions plus the complete final matrix.

At evidence export, all retained reliability-goal journals account for **963 dispatched attempts**, **$25.643693 known estimate**, **27 attempts with unknown usage**, and **1,344 recorded resources**. This includes failed candidates, configuration probes and supplemental preparation; it excludes the earlier baseline campaign. Fixed assumed rates are estimates, not provider invoices; unknown usage is never counted as free. Detailed totals and per-journal hashes are in the evidence JSON.

## Checks, delivery and remaining limits

Application-source checks pass: 1,788 behavior tests, zero failures, four opt-in skips. The unchanged optional sandbox subsystem passes all 20 cases; current browser preflight passes. Strict editor types, native Rust tests/formatting and compiler/player WASM/browser checks pass on unchanged relevant source. The final evaluator correction passes ten focused tests. The final full repository rerun passes 1,790 tests, zero failures and four optional skips; the unchanged optional sandbox cases and current browser preflight have their separate passing runs.

GitHub's earlier Node 22 check exposed a test-lifetime issue: the synthetic hung-request fixture had no live socket, so the process could exit before its unreferenced timeout signal fired. The four cancellations reproduce locally on Node 22.23.4. A test-owned interval, cleared at teardown, keeps that fixture alive; the complete test is bounded to five seconds. The same assertions pass on Node 22 and Node 25. A fresh full Node 22 repository check passes 1,790 tests, zero failures/cancellations and four optional skips. This test-only correction does not change application bytes or the measured model results. GitHub CI status is tracked on draft PR111.

Build, guarded beta dry run and deployment pass. All 240 candidate files match staged `restyle-editor-shell-60f4abbf9460f059`, with 48 old immutable assets retained and original source dist restored. HTTPS beta serves the verified candidate; the Update observer and separate ready-page proof have hash-bound reports in the evidence JSON. Both isolated browsers are closed, all 1,278 named test containers and 39 temporary storage paths are absent, and owned development ports 5295/4173 have no listeners. All 1,344 resource records are cleaned. Five unrelated local containers, Desktop pending changes, private journals and build backups are preserved.

Remaining limits are explicit:

- Some planning prose still over-specifies requirements, adds an ambiguous example, or assumes an account is absent before inspecting it. P02.4/P05.5 and E03.3/E03.5 record these findings. Concrete agreements and actual permission/evidence checks remain necessary.
- The generated guestbook can display empty numbered slots. Reopening replays the saved reply; it does not automatically fetch a newly changed shared list. A separate read operation exists, but automatic refresh is a distinct UI capability.
- Both current result Notes extend the three-second fixture to six seconds. The Try tail is black while its result remains readable; the viewer holds the frame. Visual design quality and arbitrary layouts need broader assessment.
- Stronger saved-authoring reasoning costs more and can take minutes. Temporary inference failures can still exhaust automatic retries and require an explicit Retry. Real user intent, account setup and action approval remain user decisions.
- Arbitrary providers, broader signup/phone, large concurrent load, real delivery guarantees, speech and unrestricted autonomous product development are outside this acceptance. Production remains unapproved.

To reproduce, use the current evaluator with the existing private model configuration and isolated Docker runtime:

```sh
node scripts/checks/restyle-capability/run.mjs all --repetitions=5 --label=reliability-repeat
node scripts/checks/restyle-capability/durable.mjs guestbook
```

These commands incur inference usage. The complete measured v1.6 source remains available at `e5296e5`; v1.7 adds the documented manual-terminal validation/classification correction. Original private requests, provider bodies, generated source, failed proposals, screenshots, resource receipts and orchestration-script hashes are retained under `~/.codex/secure/restyle-capability/`. Public files contain synthetic decisions, diagnostics, independent results, hashes and usage metadata, with credentials excluded.
