# Evaluation audit and reproducibility

This file preserves test-infrastructure issues and accounting. Product fixes were prohibited and no application/model/deployment change was made.

## Before live inference

The existing Docker runtime was stopped; it was started through `docker desktop start`. The existing pinned image was reused, with no image installation. Generated code received no network, mounted host directory, credentials or Docker socket. The source/expectations remain outside the guest.

Preflight validation caught a missing version in synthetic connection metadata, and an assertion expected `result_mismatch` instead of the real `mismatch` code. Both were corrected before paid calls. Actual isolation and a deliberately wrong implementation with passing generated tests were checked. These are evaluation-preparation mistakes, not product/model failures.

## Preserved live segments

1. `run-2026-10-22T00-43-33.322Z-e30e9d53` (protocol v1): 13 completed preliminary probes, one interrupted image probe, 16 API attempts including one with unknown usage. The driver incorrectly nested an already-bounded rejected-proposal object. Review found this before coding. Stop, preserve all outputs, correct only the driver, and restart the scored matrix. The preliminary P01/P02/P03 responses all failed schema validation; these additional failures are retained, not hidden by the restart. The remaining completed outputs and interrupted attempt appear under supplementary in evidence.json.
2. `run-2026-10-22T00-46-13.881Z-aa6ae87c` (v1.1): retain all 19 completed unaffected cases, including their failures. The first B04 attempt produced source that skipped the required account request. The reporter then supplied a failure code outside the product report contract, hiding the specific error behind “Case failure code is unsupported.” Its 35-call repair run was stopped and excluded from repair-performance scoring. Preserve its initial code defect and all usage. One interrupted call has unknown usage. Correct the reporter to use the existing mismatch code; test through the actual report parser. The earlier history projection was also simplified/incorrect, so reuse the app's real byte-bounded selector and honest exhausted-entry shape.
3. `run-2026-10-22T00-56-24.002Z-cd5d0bc8` (v1.2): run exactly the 23 unfinished/interrupted repetitions, retaining every completed v1.1 pass and failure. Matrix digest equality is checked before resuming. No retained coding case used the corrected connected-failure/history paths. No input or acceptance criterion changed. All 23 new runs finished and cleanup passed.

Journals live privately under `~/.codex/secure/restyle-capability/`, mode 0600. Each contains frozen source/fixture hashes, full requests and provider bodies without credentials, all generated source, decisions, checks, errors, timings, usage and resource receipts. The public [evidence](evidence.json) retains segment hashes, per-call metadata, actual probe outputs, review reports and separate excluded/supplementary observations. [Grades](grades.json) are Codex rubric review, not blinded human grading. All four scored documentation-evidence notes additionally passed the application's actual excerpt/result validators after generation.

The coding driver uses actual planner/state/tools/validators with a local checkpoint journal. It does not run the entire durable coordinator. Its history sequence allocation and operation projection differ from the coordinator, and it does not reproduce the coordinator's three-unchanged-results help/escalation workflow. Therefore a local autonomous eventual pass does not prove the production UI would complete without asking for help. This limitation is especially material for B04.1 and R01.1. The invalid v1.1 B04 repair loop must never be used as evidence against the product.

## Reproduce

From the canonical Restyle worktree, with the existing Runpod credential and Docker image available:

```sh
RESTYLE_MODEL_SANDBOX=1 node --test tests/restyle-capability/evaluation.test.mjs tests/model-comparison.test.mjs
node scripts/checks/restyle-capability/run.mjs
```

The second command incurs real inference usage. Optional `probes` or `builds` runs that subset twice in a new journal. The campaign's interrupted full matrix was continued with `run.mjs resume /absolute/path/to/report.json`; retained IDs and predecessor are recorded. Do not discard failures when choosing scored attempts. The summarizer rejects incomplete runs, changed matrices, duplicate/missing repetitions and success grades on execution failures:

```sh
node scripts/checks/restyle-capability/summarize.mjs /absolute/path/to/latest/report.json /absolute/path/to/preliminary/report.json
```

Read the [frozen protocol](../restyle-cloud-agent-roadmaps/06-capability-baseline.md) before another run. App baseline is source c100993 (application implementation 06eeae1), Kimi K2.6 via the real Runpod adapter, thinking disabled, temperature 0.6. Preparatory evaluator commits are 073342f, 123739c and 3cb4081. There are no total-turn quotas added to Restyle. The ten-minute build window is only an observation boundary for this experiment. No run reached it.

Local wall times include network and sandbox overhead; repository checks ran concurrently during parts of the campaign. They are descriptive timings, not controlled production performance benchmarks. Costs use fixed assumed rates of $0.95/million input tokens (including cached input) and $4/million output tokens. They are estimates, not an invoice. Missing usage is unknown, never free.
