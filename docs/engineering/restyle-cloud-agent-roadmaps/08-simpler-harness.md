# Simpler harness comparison

The creator authorized implementing and testing the simpler harness on 22 October 2026. Keep the model, immutable behavior agreements, independent checks, permissions, durable execution and duplicate prevention unchanged. Simplify one burden first: the model chooses source actions and review paths; Restyle binds them to the source snapshot shown during that inference. Research evidence selection and the other planning contracts are outside this first ablation.

## Checklist

- [x] **8S.01** Freeze the baseline, candidate scope, fresh tasks and comparison rules before measuring.
- [x] **8S.02** Remove model-supplied source revision/digest fields; preserve exact-version execution, concurrency rejection and independent review with regression coverage.
- [x] **8S.03** Compare both harnesses using the same model/settings, five existing coding/repair tasks and two fresh tasks, twice each. Preserve unsuccessful outputs and all usage.
- [ ] **8S.04** Verify complete saved guestbook/email journeys, source checks and resource cleanup. Deliver a verified beta only if the candidate meets the comparison gate.

## Experiment contract

Baseline is `67c38621829ed503382f72fd2329fc1a8c73fd93`, with application bytes equivalent to the verified beta. Existing tests B01–B04/R01 retain their inputs and independent holdouts. Fresh cases cover atomic inventory withdrawal and expiring one-use codes; their expected behavior is frozen before either arm runs. Each arm receives two repetitions of all seven tasks. No model output or expected result is edited during a run. The same ten-minute observation window and actual generated/independent execution apply. Record success, calls, format repairs, failed tool calls, elapsed time, token usage and estimated cost. This small sample can detect regressions; it does not establish universal reliability or a statistically significant speed improvement.

Accept only with all fourteen candidate tasks passing their independent cases within the existing observation window, no new safety regression, no worse aggregate format-repair or tool-failure counts than baseline, and passing complete saved/browser journeys. If it fails, retain the current beta and record the result before adjusting the candidate; never relabel a failed attempt. Compare latency/cost descriptively, not as guaranteed savings. The complete earlier 105-run acceptance remains historical evidence, not a new claim for this candidate.

## Ownership and resources

Worktree: `/Users/christinasmacbook/.codex/worktrees/restyle-simple-harness/pvo-prototype`, branch `codex/restyle-simple-harness`. Current `origin/dev` was fetched (`7583d1a`). Starting there and merging the unfinished MVP produced fourteen conflicts, including the unrelated Clerk-to-Supabase sign-in change. That uncommitted merge was aborted. This controlled continuation therefore isolates the exact unfinished beta baseline; integration with dev remains separate and unclaimed. The baseline checkout and Desktop changes are untouched.

Use the existing measured Runpod transport and network-disabled local Docker executor. Every model request and temporary container must be recorded before dispatch and cleaned through the existing journal. Real email is not needed; the connected journey uses controlled provider replies. No production deployment, account migration or permanent resources. Private outputs remain under `~/.codex/secure/restyle-capability/`; only sanitized summaries enter Git.

## Current checkpoint

The model-input boundary and three focused regression cases are implemented and pass, including actual workspace concurrency/replay. Fresh inventory/invitation inputs parse through the actual contract. Full source checks are running; live inference has not started. Candidate and baseline will run sequentially, alternating which arm goes first by repetition, through the same evaluator and isolated executor. Exact source/evaluator/matrix hashes and every outcome will be retained. Next: finish checks, checkpoint and start the paired run.

Source verification: full `npm run check` passes 1,793 tests, zero failures/cancellations, four optional skips. The follow-up evaluator contract test and fresh fixtures pass separately; strict editor types pass. Source changes are frozen before the paired live run.

## Paired result and final verification

All 28 runs finish: 14/14 per arm, zero format repairs, 42 baseline calls versus 43 candidate calls. Candidate has one autonomously repaired generated-test syntax failure; baseline has zero failed tool attempts. The predeclared no-worse gate therefore rejects rollout. All original results are retained; no threshold changed. See [the report](../restyle-capability/harness-comparison-results.md) and [evidence](../restyle-capability/harness-comparison-evidence.json). All 390 recorded containers are cleaned.

The pure model-input module is subsequently moved into the shared builder package, with byte-identical function bodies and public exports. The existing AgentMail timeout mock receives a bounded keep-alive after its GitHub cancellation is reproduced without a live socket. The final Node 22 full check passes 1,794 tests with four optional skips, no failures/cancellations; editor types, forty focused builder/transport tests and four focused Node 22 checks pass. Next: candidate build and complete saved/browser journeys. Beta remains unchanged because the comparison gate did not pass.
