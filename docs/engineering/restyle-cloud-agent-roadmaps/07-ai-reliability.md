# Roadmap 7 — reliable AI for the current MVP

Authorized 22 October 2026: make Restyle AI reliable, fix the measured failures, and continue until the supported MVP passes meaningful independent verification. This supersedes Roadmap 6's test-only restriction; its original baseline remains unchanged. Broader account signup/phone and production release remain deferred.

## Completion criteria

Reliability here means the supported MVP completes correctly and recovers from the measured mistakes, not that arbitrary AI requests are guaranteed to work.

- Repeat the unchanged 21 baseline scenarios five times on the final candidate. Keep every result. All final outputs must meet their original semantic criteria; report first-decision failures separately from autonomous recovery. Planning may recover through the actual saved validator feedback. Missing-account cases must reach a concrete setup/help decision within a bounded multi-turn test instead of remaining inconclusive.
- For the 25 coding/seeded-repair runs, every independent public and hidden case must pass without developer hints, edited source or altered agreements. Each run must finish within ten minutes and 12 inference calls, with at most two format repairs. These are measurement gates, not application request-count limits.
- At least 95% of the 40 planning first decisions must satisfy the closed output contract. No accepted fake account request, invented result, stale-source approval or weakened isolation/permission boundary is allowed.
- Exercise the actual durable coordinator with live inference, including planning through checked source, saved repair feedback, restart, missing/revoked account and interrupted inference. Genuine user decisions may wait; preventable technical repair must not need a person to supply schema or source corrections.
- Verify complete generated UI → Try → export → viewer/reopen journeys for supported local storage and the connected MVP. Use controlled account effects for repeated tests; the existing recipient-confirmed email receipt is historical live evidence. Do not resend it simply to test recovery.
- Pass the appropriate repository, editor, browser and build checks. Deliver the candidate to the authorized beta, verify exact served release and preserve open clients. Record usage, resources, cleanup, remaining limits and the exact next task.

If a criterion proves unsuitable, document its evidence and rationale before changing it; never relabel a failed attempt as a pass. Keep the first-decision baseline and eventual-workflow metrics distinct.

## Tasks

- [x] **7R.01** Freeze reliability acceptance criteria and inspect the measured failures and existing owners.
- [ ] **7R.02** Make planning and tool decisions structurally dependable; preserve meaningful validation and record controlled experiments.
- [ ] **7R.03** Make final review use current source and advance after successful work; verify recovery in the durable coordinator.
- [ ] **7R.04** Verify connected requests/results, missing/revoked access, interruption and duplicate prevention without false completion.
- [ ] **7R.05** Run the complete final repeated matrix and full generated-component journeys; preserve all unsuccessful attempts.
- [ ] **7R.06** Complete source review/checks, beta delivery and release verification; document evidence and clean owned test resources.

## Work and resource journal

Continue the existing unreleased Restyle MVP implementation in the research-connections checkout, branch `codex/restyle-agent-identity`, based on baseline `762b293`. Current `origin/dev` is `7583d1a` and contains a separate editor/auth integration; this work continues the unfinished MVP stack rather than incorporating that separate release work or changing the creator's identity. PR110/111 remain draft/unmerged. Desktop pending files and serving assets are preserved.

Existing Runpod inference and local network-disabled Docker may be used for controlled experiments. Each paid request and test container is recorded before dispatch in a private journal; no credentials enter source/reports. Record any needed beta/Fly test resources before creation and cleanup afterward. No additional provider account or permanent compute is planned.

First experiment: actionable empty-review-batch feedback and smaller stage-specific planning instructions, with exact current source guidance. Preserve schema checks and the original independent behavior cases. Verify targeted regressions before live comparison; do not change the model and prompts simultaneously.


## Candidate checkpoint

Diagnostic-only change b75bb1f is insufficient: the first connected run reached its ten-minute observation window without repair. The next candidate changes phase-specific instructions and authoritative source/review context while retaining Kimi K2.6, thinking disabled and temperature 0.6. Agreement generation receives 12,000 output tokens; code generation remains 6,000. The evaluator's extra full-source projection is removed to match the actual coordinator. Targeted tests pass; repeated model runs, complete durable journeys and beta delivery remain unverified. See the latest progress entry and private experiment journal; 7R.02–06 remain unchecked.
