# Roadmap 10 — learn through repeated product use

The creator wants Codex to use Restyle to build and improve real PVOs, expose its limits, and continue until the creator is comfortable using the AI directly. The primary requirement is cumulative progress: understand existing work, change it safely, repair failures and continue after reopening. First-attempt perfection and low model-call counts are not acceptance gates.

- [ ] **10U.01** Push the current experimental AI branch and evaluation/handoff records to GitHub; verify the remote commit and provide PC checkout instructions.
- [ ] **10U.02** Establish an actual product-use baseline: record the served build/backend, create or select a disposable PVO, and capture its initial working behavior.
- [ ] **10U.03** Exercise one PVO through ordinary requests to build, extend, revise, repair and reopen/continue. Verify preserved behavior after every step and retain failures and any manual intervention.
- [ ] **10U.04** Extend the same method to varied supported PVO workflows and record capability limits, repeatable defects and improvements. Creator confidence is a user decision; do not mark it achieved from a fixed test count or assume universal reliability.

## How to use it

Start with a simple interactive PVO, inspect it through Try and the anonymous player where applicable, then change the same project over multiple requests. Add a feature, revise an earlier requirement, correct an observed problem and resume after reopening. Use existing native editing, PVO interactions, value capture/inbox and installed service capabilities. A difficult request is an opportunity to observe capability handling; it does not authorize adding a new product feature to satisfy a benchmark.

Use normal creator-facing requests. Allow the AI to inspect, retry and repair through its own available tools. Distinguish a normal follow-up requirement from a technical rescue supplied by Codex. If Codex changes product source to fix a demonstrated defect, end the current measurement, retain its evidence and identify the new build before retesting. Tests must not silently include a manual repair as an autonomous success.

For each step record the request, starting project/build, visible result, existing behavior preserved or broken, AI recovery, any creator/Codex intervention, and saved/reopened result. Inspect the actual component/video as well as backend receipts where relevant. A later success does not erase an earlier failure. Keep private inputs, credentials and personal media out of tracked evidence.

The next product-use session should begin with the same-project sequence above. Do not launch another large synthetic matrix just to increase the number of tests. Existing deterministic regressions remain useful for protecting platform boundaries. Use controlled external effects unless the creator has explicitly authorized the particular real action.

## PC source handoff

Use `codex/restyle-simple-harness` in `jaffakakes/pvo-prototype`. This branch contains the experimental AI changes and their tests/results; its complete history includes the prerequisite AI work. It remains a draft stacked on PR111 through [PR116](https://github.com/jaffakakes/pvo-prototype/pull/116). Pulling it does not merge it into `dev` or deploy the beta/production service. The historical comparison's failed rollout gate remains recorded; the creator has now explicitly authorized sharing this branch for continued testing.

In the existing PC checkout, with local changes preserved:

```sh
git fetch origin
git switch codex/restyle-simple-harness
git pull --ff-only origin codex/restyle-simple-harness
npm ci
```

The branch name normally creates a tracking checkout on first use after fetching. If Git reports conflicting local changes, preserve them before switching; do not reset or discard them. Node 22+, Rust/WASM prerequisites and runtime commands are in [the repository README](../../../README.md#run-the-prototype) and [scripts guide](../../../scripts/README.md).

Git transfers source and documented configuration, not private model credentials, account sessions, local projects or backend records. Live AI needs the existing configured backend/Worker; the static development server and Vite alone do not provide it. Keep credentials in the established private setup. Record the actual backend before interpreting a PC run as a test of this branch's harness.

## Verification and status

Preparation is documentation-only. The previous full source check passed 1,799 tests with seven optional skips; the subsequent focused boundary review passed 41 tests and a real Chromium isolation check. Application source remains `cfec63c`. Fresh live iterative-use tests have not started. Push verification and the exact next step are recorded in [current progress](../restyle-cloud-agent-progress.md).
