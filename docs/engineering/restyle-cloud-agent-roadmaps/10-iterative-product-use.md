# Roadmap 10 — learn through repeated product use

The creator wants Codex to use Restyle to build and improve real PVOs, expose its limits, and continue until the creator is comfortable using the AI directly. The primary requirement is cumulative progress: understand existing work, change it safely, repair failures and continue after reopening. First-attempt perfection and low model-call counts are not acceptance gates.

- [x] **10U.01** Push the current experimental AI branch and evaluation/handoff records to GitHub; verify the remote commit and provide PC checkout instructions.
- [ ] **10U.02** Establish an actual product-use baseline: record the served build/backend, create or select a disposable PVO, and capture its initial working behavior.
- [ ] **10U.03** Exercise one PVO through ordinary requests to build, extend, revise, repair and reopen/continue. Verify preserved behavior after every step and retain failures and any manual intervention.
- [ ] **10U.04** Extend the same method to varied supported PVO workflows and record capability limits, repeatable defects and improvements. Creator confidence is a user decision; do not mark it achieved from a fixed test count or assume universal reliability.
- [ ] **10U.05** Extract the AI harness and backend into the current PC editor without importing the older UI, verify the integration, preserve recovery history and remove `codex/restyle-simple-harness` as explicitly requested on 23 October 2026.

## Current PC integration — 23 October 2026

The creator requested the AI implementation from `83fb1f8`, while retaining the current editor and Supabase authentication. Work is isolated on `codex/restyle-ai-integration`, based on current dev `7ecace6` plus the preserved PC working source checkpoint `529b1fb`. The original dirty PC checkout is unchanged. Source history is saved in a verified recovery bundle outside tracked files before branch cleanup.

The selected transfer contains the saved builder, host-bound versions, durable tasks/workspaces, service execution and attachments, provider recovery, contracts and evaluation evidence. Older layouts, CSS, component defaults and management panels are excluded. Existing screens receive only nonvisual task-status, connection-sync and export-delivery wiring. Private setup uses the existing Supabase verification and checks its linked subject against the cookie owner; Clerk is not restored.

Verification passes 1,905 Node tests with seven optional skips, editor types, dependency boundaries/reachability, 24 Rust cases and formatting, build and browser checks for chat across three viewports, native edit/Undo/Stop/retries, task/project persistence and connected Apply/Try/export/recovery. All 354 recorded UI files retain their styles and JSX: 351 are content-identical and three contain only nonvisual wiring. The retained recovery command is exercised directly because its old management/recovery panel is intentionally excluded. Windows fixture/runtime-path assumptions are corrected. Fifteen focused local auth/origin/assistant tests pass after wiring the exact HTTPS phone origin through the existing local policy. Repository-wide formatting reports pre-existing untouched baseline files; changed nonvisual files are formatted. Source branch deletion remains pending until the verified source is safely committed. No cloud deployment, provider inference or external email is part of this integration.

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

The source/evaluation handoff was pushed at `2b31fbb8eeee64e7f75d8a8230ecc81e5524f2c2`; both `git ls-remote` and GitHub PR116 confirmed that exact SHA. This documentation checkpoint records completion afterward. GitHub checks were in progress at verification. Preparation is documentation-only. The previous full source check passed 1,799 tests with seven optional skips; the subsequent focused boundary review passed 41 tests and a real Chromium isolation check. Application source remains `cfec63c`. Fresh live iterative-use tests have not started. The exact next step is recorded in [current progress](../restyle-cloud-agent-progress.md).
