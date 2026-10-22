# Restyle capability baseline — 22 October 2026

Status: prepared; live run is starting. Do not infer a pass from this checkpoint.

Protocol and all pass criteria: [Roadmap 6](../restyle-cloud-agent-roadmaps/06-capability-baseline.md). Twenty-one scenarios, two repetitions each. Application source remains unchanged; current Kimi K2.6 adapter, thinking disabled. Ten evaluation self-checks pass, including actual Docker isolation and independent rejection of faulty code despite passing generated tests.

## Reproduce

From the canonical checkout, run:

```sh
RESTYLE_MODEL_SANDBOX=1 node --test tests/restyle-capability/evaluation.test.mjs tests/model-comparison.test.mjs
node scripts/checks/restyle-capability/run.mjs
```

The second command makes paid requests through the existing Runpod account. It reads the existing private RUNPOD_API_KEY; it never logs credentials. Requires the existing running Docker daemon and image `restyle-node-runtime:1g-proof` (checked Node 24.20.0). No packages/accounts are installed. Optional `probes` or `builds` selects a subset, always with two repetitions and a new journal. Never overwrite an earlier run or report a subset as the full matrix.

Full journals are atomic mode-0600 files beneath `~/.codex/secure/restyle-capability/`; filenames include timestamp and random ID. Each holds frozen fixture/script digests, actual prompts/provider bodies, generated source, tool/validation results, usage, timing, container intent and cleanup. Synthetic images only. No real email or GitHub write. A future public summary should include safe per-case outputs and grades, never keys or account records.

## Evaluation preparation issues

Before live inference, fixture validation caught a missing `version` in synthetic connection metadata, and a one-off sandbox assertion expected `result_mismatch` instead of the current `mismatch` diagnostic. Both evaluation mistakes were corrected and the complete ten-check self-test passed. No paid model attempt is excluded by these preparation errors.

## Coverage limits

Planning probes test one next action, and native editor proposals are validated without applying them to a browser. Build tests start from fixed agreements, use local isolated Node and controlled provider results, and exclude cloud capacity, actual provider access and rendered component quality. Native image reading sees synthetic sampled frames, not a finished generated component. Two repetitions cannot estimate a general reliability rate. Keep deterministic recovery tests and historical live email acceptance separate from new model performance.

Next: execute all 42 runs; grade manually against frozen semantic criteria and independently check source behavior; preserve failures and rank fixes without implementing them.

## Preliminary run retained

`run-2026-10-22T00-43-33.322Z-e30e9d53` was deliberately stopped before coding because the evaluation driver had incorrectly nested rejected-proposal feedback. Completed one-step planning and editor observations remain valid supplementary evidence, with all failures retained. The unfinished attempt is operator-interrupted and its charge is unknown. They are not substituted for the complete v1.1 matrix. The driver correction changes no product code, model, scenario or rubric. A new regression check verifies actual planner repair messages contain the exact proposal string.
