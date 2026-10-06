# 1F: prove the complete journey

[Roadmap 1](restyle-cloud-agent-roadmaps/01-first-working-component.md#1f-verify-the-complete-first-release) · [Progress](restyle-cloud-agent-progress.md) · [Handoff](restyle-cloud-agent-handoff.md)

## In plain English

The earlier steps built the parts. This milestone asks the real AI to put them together twice: a dinner RSVP with limited seats, and a camera booking form that prevents overlapping bookings.

The temporary workshop writes and tests the code. The separately hosted service keeps the saved RSVPs or bookings and answers viewers after the workshop stops. Publishing makes that checked service available to its connected component; it does not share a plugin or install something for other creators.

**Status, 6 October 2026:** local preparation only. All 1F tasks remain unchecked. Local diagnostic tests and a Wrangler deployment dry run pass. No paid inference, cloud resource creation or public product deployment is claimed by those checks. The separate combined beta rebuild/delivery is recorded in progress; it does not establish live 1F acceptance.

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

## Run and recover

From the active checkout, after approval:

```sh
node scripts/checks/cloud-agent-first-release/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run-approved-15-usd
```

Use privately supplied `RUNPOD_API_KEY` or a nonempty `apikey` in the Runpod CLI configuration. The script never prints the key. A file existing is not sufficient: the first approved launch found an empty key and stopped before any resource creation or charge. On this Mac, the user can enter it privately with:

```sh
node scripts/checks/cloud-agent-first-release/configure-key.mjs
```

This opens a hidden-entry dialog and saves the CLI setting with owner-only permissions. Never paste a key into chat or commit it. The user approved this secure entry step on 6 October. Cloudflare uses existing Wrangler authentication. Read-only access was verified; a live model call has not been used as an authentication check.

The private `.wrangler/cloud-agent-infrastructure/workspace-*/report.json` is written before resource creation. It includes names, limits, task revisions, generated source/agreement/test results, service identities, usage and cleanup. Secret files are separate and are deleted after verified cleanup. If interrupted, inspect that journal before any new run; do not create a replacement deployment while cleanup is unresolved. Recover from the same checkout with:

```sh
node scripts/checks/cloud-agent-first-release/cleanup.mjs 84880ccf8f98bb789d58cbea5436a645 .wrangler/cloud-agent-infrastructure/workspace-REPLACE/report.json
```

Use the exact recorded journal path. Recovery cannot deploy or create a resource. It verifies the account, random owned names and private paths, reconciles provider records, and preserves credentials only when cleanup is unresolved.

The current driver covers real authoring through a saved attachment and verifies the workshop is absent. **It does not yet execute the full browser/recovery matrix below.** Implement the remaining driver/browser controls locally before expanding paid acceptance. The live authoring run may expose generation or provider defects; preserve the failed evidence and fix the actual issue rather than inserting a prepared program.

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
