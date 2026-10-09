# Restyle model cost and coding comparison

The creator authorized this comparison on 9 October 2026. The question is which model creates correct disposable software at a useful price and speed. Existing Roadmaps 1–4, BETA and E2E completion remain unchanged. This is an isolated experiment; production and the beta's configured model remain unchanged.

## Plain-language plan

Give Kimi K2.7 Code and GPT-6.1 Sol the same three small jobs: a shared guestbook, a limited-space booking list and a poll that closes at a supplied time. Give each the same already-agreed requirements. Let it write JavaScript and its own tests through Restyle's existing coding planner. Run the code and compare its answers independently. Return actual failures to the same model so it can repair its work.

This first pilot measures **the coding stage after requirements are agreed**. It does not measure questions, research, visual component generation, live cloud startup, deployment or the whole creator journey. One run per model/request is preliminary evidence, not a broad model ranking. The earlier guestbook acceptance's elapsed time included human intervention and harness fixes and is not a comparison baseline.

## Equal conditions and recorded differences

- Identical requests, frozen agreements, planner instructions, JSON decision validation, tool schemas, source revision rules, generated-test checks and additional independent cases. Initial prompt hashes must match within each pair.
- Same local pinned Node 24.20.0 image, fresh network-disabled Docker container per command/operation, one CPU, 256 MiB, no host mounts, credentials or Docker socket. All generated code runs there; source and expected answers stay with the host. Independent expected values never enter the generated process.
- Kimi `kimi-k2.7-code`, thinking enabled; Sol `gpt-6.1-sol`, high reasoning, standard Responses service, storage disabled. Provider sampling and reasoning controls differ and are recorded. This compares these configurations, not an isolated model-only effect.
- Both use JSON object mode with the same schema in instructions and local strict validation. Both receive 32,768 maximum output tokens per inference, including reasoning. This differs from beta's 6,000-token builder setting and avoids cutting off reasoning before code. Inference transport timeout is 180 seconds; workspace commands retain bounded execution. **No fixed model-turn ceiling is added.** A provider failure or a genuine creator question is recorded honestly, with saved source/evidence.
- Generated tests run, then the exact saved package passes the current artifact validator and independent checks. The independent runner uses fresh processes between steps and carries state externally. This checks explicit state recovery, not the deployed database or HTTP lifecycle.
- Three request pairs, sequential runs with alternating candidate order. Repetition would be a separate follow-up if these results leave a concrete uncertainty.

## Measurements

Record total elapsed time, inference time, every inference and rejected decision, generated-test failures, independent repairs, exact final source and result. Price provider-reported input, cache and output usage; reasoning is already part of billable output. Missing usage and interrupted requests remain **unknown**, never zero. Prices are estimates from published rates, not an invoice. Per-success cost includes all attempts and unsuccessful builds in that candidate's pilot. Local Docker has no cloud compute charge; local electricity is not metered. No email, real booking, paid GPU, Fly Machine or service publication is part of this experiment.

Pricing references checked 9 October: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Runpod Kimi variants](https://docs.runpod.io/public-endpoints/models/moonshot-kimi). Standard rates per million input/output tokens: Sol US$2/US$10 (cached input US$0.10); Kimi US$0.95/US$4. OpenAI API use is separate from the Codex subscription.

## Checklist

- [x] **MC.01 — Freeze the comparison.** Three synthetic requests, explicit scope, common requirements and independent expected outcomes are saved in the runner fixtures.
- [x] **MC.02 — Verify the harness.** Five checks pass, including real isolated Node execution: deliberately wrong code passes its own test but fails the independent gate; network/key access is denied and all owned containers are removed. Usage/cache/reasoning arithmetic, equal initial prompts, key exclusion, rejected-request journaling and model-substitution rejection pass. Syntax (1054 modules), dependency boundaries (1030), formatting (807) and 149 local documentation links pass. Both exact model connections are available.
- [x] **MC.03 — Run both candidates.** All six builds pass on source revision 1, without rejected decisions, failed tools, independent repair or creator intervention. Sixteen real inference calls report exact requested models and complete usage. Each pair has an identical initial prompt hash. See measured results below.
- [x] **MC.04 — Review and clean up.** All73 named pilot containers are verified removed, private setup server stopped and temporary local OpenAI key deleted. Results/source/tests and the cache-write correction are committed/pushed in `0f810ad`; draft PR #110 includes the measured comparison. Final source and link checks pass. App model, beta assets and production are unchanged.

## Run and handoff

Source: `scripts/checks/model-comparison/`. Run from the current Restyle beta source checkout with `node scripts/checks/model-comparison/run.mjs`. Reprice/check a finished private journal and export portable evidence with `node scripts/checks/model-comparison/summarize.mjs /absolute/private/report.json docs/engineering/evidence/restyle-model-comparison-YYYY-MM-DD.json`. An optional `kimi` or `sol` argument runs only that candidate and cannot establish a two-candidate result.

The private OpenAI key is entered by the human and stored outside Git in `~/.codex/secure/restyle-model-comparison/openai.token`. The existing beta Runpod key stays in its private deployment storage and is never copied into generated code. Each run saves its journal under `~/.codex/secure/restyle-model-comparison/run-*/report.json` with private permissions. Each model request and named container intent is written before dispatch; source/checkpoints and cleanup outcomes remain there. Private receipts are supplementary; portable measured results must be recorded below before completion.

## Results

Completed 9 October 2026, 00:30:56–00:35:39 UTC. [Portable measured evidence, generated source/tests and original token counts](evidence/restyle-model-comparison-2026-10-09.json) allow review and repricing without API credentials. Private raw request/response journal remains supplementary. No outer-agent implementation was substituted.

| Job | Kimi K2.7 Code — time / AI estimate | Sol high — time / AI estimate | Independent outcome |
| --- | --- | --- | --- |
| Guestbook | 38.4 seconds / US$0.03574 | 45.4 seconds / US$0.06346 | Both pass |
| Limited-space booking | 45.7 seconds / US$0.03850 | 46.4 seconds / US$0.05426 | Both pass |
| Deadline poll | 48.5 seconds / US$0.04376 | 57.9 seconds / US$0.07141 | Both pass |
| **Average per successful build** | **44.2 seconds / US$0.03933** | **49.9 seconds / US$0.06304** | **3/3 each** |

Kimi uses ten inference calls; Sol uses six. Both pass all three first source versions. Total estimated AI usage: **US$0.3071215** (Kimi US$0.1179975; Sol US$0.189124). No inference has unknown usage. Kimi is approximately **37.6% cheaper** and **11.4% faster by mean elapsed time** in this small sample. There is no demonstrated quality advantage for either model on these jobs. Inference-only averages are 35.6 seconds for Kimi and 41.1 for Sol; remaining elapsed time includes the actual local checks.

Each model passes 12 independent cases / 28 steps across the three jobs, including blank input, a retained full guestbook, 200 emoji, newest-three ordering, duplicate acceptance before capacity rejection, cancellation freeing a place, zero capacity, changed votes, read-only totals and the exact closing-time boundary. Every operation starts a fresh isolated process with state carried by the host. Generated tests also pass; their own assertions alone cannot approve the result.

**Metering correction:** inspecting actual Sol usage revealed `cache_write_tokens`. Early live-console Sol estimates charged those tokens at ordinary input rates. The meter now prices them at the published US$2.50/M rate, and an additional regression covers the premium and impossible cache totals. The evidence/table above is repriced from original provider usage and supersedes early console estimates. Cache reads, cache writes and ordinary input are counted separately; reasoning is included once within output tokens. No paid inference was repeated for repricing.

**Practical decision:** Kimi K2.7 Code with thinking enabled is the better next beta candidate for these small coding jobs. Sol did not earn its higher price in this pilot. This does not establish performance on ambiguous requests, research, complex integrations, frontend authoring or repairs: there were no repair failures to compare. The current beta still uses Kimi K2.6 with thinking disabled; switching its model is a separate product change and needs the ordinary beta verification. No automatic fallback or fixed goal-turn cap is introduced.

**Cleanup:** all 73 named pilot execution containers are verified removed; a fresh Docker inventory has zero `restyle-model-` containers. The private loopback key-entry server is stopped and the temporary local OpenAI key copy is deleted. The user's actual OpenAI API key is not revoked. Existing beta Runpod credentials remain retained privately. No cloud GPU, Fly Machine, service publication, email, app deployment or production change occurred. This experiment does not alter Roadmaps 1–4/BETA/E2E completion.

**Checks:** the five focused checks pass, including actual sandbox rejection and cleanup. The cache-write correction's four default unit checks pass (the previously verified Docker check is opt-in). Initial whole-source syntax 1054 modules, boundaries 1030, formatting 807 and 149 local links pass. Final syntax1055 modules, boundaries1030, formatting808 and152 local links/anchors pass; all134 historical task IDs/states are unchanged. Source/documentation commit references are recorded in current progress. No app behavior or generated beta assets changed; app build/browser suites are not required for this checks-only experiment.
