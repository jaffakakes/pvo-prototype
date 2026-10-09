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
- [ ] **MC.03 — Run both candidates.** Save all six outcomes, usage, timings, repairs and unresolved failures without substituting outer-agent source.
- [ ] **MC.04 — Review and clean up.** Verify owned containers removed, stop private key-entry server, remove temporary local OpenAI key after this test, record results and practical recommendation, commit/push documentation and checks. Keep app model and production unchanged.

## Run and handoff

Source: `scripts/checks/model-comparison/`. Run from the current Restyle beta source checkout with `node scripts/checks/model-comparison/run.mjs`. An optional `kimi` or `sol` argument runs only that candidate and cannot establish a two-candidate result.

The private OpenAI key is entered by the human and stored outside Git in `~/.codex/secure/restyle-model-comparison/openai.token`. The existing beta Runpod key stays in its private deployment storage and is never copied into generated code. Each run saves its journal under `~/.codex/secure/restyle-model-comparison/run-*/report.json` with private permissions. Each model request and named container intent is written before dispatch; source/checkpoints and cleanup outcomes remain there. Private receipts are supplementary; portable measured results must be recorded below before completion.

## Results

Pending. No winner, speed improvement or measured build price is claimed yet.
