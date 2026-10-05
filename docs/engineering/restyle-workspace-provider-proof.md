# Workspace provider verification evidence

[Progress](restyle-cloud-agent-progress.md) · [Roadmap 1C](restyle-cloud-agent-roadmaps/1c-generated-services.md) · [Workspace contract](../../packages/pvo-assistant/workspaces/README.md)

## Status

**Passed on the first approved real provider run; cleanup verified.** The disposable diagnostic in `scripts/checks/cloud-agent-workspaces/` ran against actual Cloudflare Containers on 5 October 2026. No second run is needed. Local workerd tests and Wrangler dry run passed beforehand.

The earlier US$15 approval covered the completed 1B provider-recovery batch. The user explicitly approved **US$1 in additional variable usage for at most two runs**, replying “Approve up to US$1” to the prepared test plan. Stop after the first passing run. This authorizes the bounded disposable workspace diagnostic below; it does not authorize model calls or unrelated deployments. No resource was created before this approval.

## What this checks in plain English

1. Save a small program outside the temporary computer.
2. Start its computer, restore the saved program, then deliberately interrupt its coordinator before it receives a completion receipt.
3. Find the same workspace, preserve its source, shut down the uncertain computer and restore the files into a fresh one.
4. Repeat a request and prove that it returns its saved result without another start.
5. Run the fixed diagnostic tests with Internet blocked and platform credentials absent.
6. Stop the task and reject late starts, including a task stopped before its first files arrive.
7. Run a command that never finishes and spawns a child process. Destroy the whole computer at the deadline.
8. Run a command that prints too much. Stop it and retain the saved source.
9. Remove every disposable resource and verify that it is gone.

These are fixed infrastructure diagnostics. They do not show that the model can generate services or that generated tests can approve their own releases. Saved-task operation accounting, model tools and the independent trusted test gate still need their roadmap work. Leave 1C.02/1C.03/1C.04/1C.09 unchecked until their complete acceptance conditions are met.

## Resources and limits

| Resource or action | Maximum per run |
| --- | --- |
| Disposable Worker | One, named `restyle-workspace-proof-<random ID>` |
| Container application | One, with only `WorkspaceProof` attached |
| SQLite Durable Object namespaces | Two: workspace and global budget |
| Fixed workspace identities | Four: recovery, stopped, timeout, output |
| Actual starts expected | Four; platform ceiling of twelve |
| Concurrent computers | Two; the diagnostic driver runs sequentially |
| Computer size | `lite`: 1/16 vCPU, 256 MiB RAM, 2 GB disk |
| Computer time | 120-second platform bound, also capped by the 60-second task execution claim |
| Startup/command | 20 seconds / 15 seconds |
| Combined command output | 16 KiB |
| Driver/control requests | 50 / 60; read-only health propagation is separately bounded |
| Diagnostic authorization | Expires after 20 minutes; authenticated cleanup remains available |
| Model calls, messages, bookings | Zero |

Current rates imply under US$0.003 for the conservative maximum 24 aggregate minutes of `lite` compute per run, before included allowances. Workers and Durable Objects also incur usage; **under US$0.10 per run is an estimate, not a bill or account-wide spending cap**. The US$1 proposal is a cushion for this bounded batch. The already enabled monthly Workers plan is separate. Rates checked 5 October 2026: [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/) and [instance sizes](https://developers.cloudflare.com/containers/platform/limits/).

## Execution and cleanup

Only after approval, from the active workspace checkout:

```sh
node scripts/checks/cloud-agent-workspaces/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run
```

The helper selects random unused names and records the target, bounds and resource identities before creation. Secrets stay in private local files and Worker bindings. The report under `.wrangler/cloud-agent-infrastructure/workspace-*/report.json` records exact bundle hashes, checks and cleanup. The deployment helper attaches only the workspace class to a Container; the global budget class stays ordinary SQLite storage.

On failure or success, stop all owned workspaces, delete their private diagnostic contents, remove the Container application and Worker, and verify absence of the Worker, application and both namespaces. Delete local secret files after cleanup is confirmed. Preserve non-secret receipts. Do not run another batch while any prior cleanup is unresolved. No main Restyle deployment, beta reload or GitHub check is part of this diagnostic.

## Actual provider result — 5 October 2026

- **Source:** `948617a4f5c470f932cbba4e08124945f1e13fe0`. All imported diagnostic sources were unchanged; pending documentation and unimported task-bridge files were outside the deployed bundle.
- **Bundle SHA-256:** `proof-worker.js` → `14b7bb291f3419226a9e9d8823b4d2120db7751ec88f09e79b7df63417fa8dc5`.
- **Time:** `2026-10-05T21:31:23.794Z` through `2026-10-05T21:32:18.789Z`.
- **Worker:** `restyle-workspace-proof-c6f03618115b53864ef6e7f3`.
- **Container application:** `321c63b2ffad4208b65399ecbe96ddea`.
- **SQLite namespaces:** `321c63b2ffad4208b65399ecbe96ddea` and `463c78f4ff9443ddb0a0c3d7c6a90ce6`.
- **Checks:** saved source and workspace identity recovered after forced coordinator reset before start receipt; fresh restoration ran real Node tests with Internet blocked and platform credentials absent; exact replay did not start another computer; Stop blocked late creation (including before initialization); command deadline destroyed the whole Container and its child process; output overflow stopped execution while preserving saved source. All passed. The driver made 22 calls; no model calls.
- **Cleanup:** all four fixed workspace identities reported their computers absent. Diagnostic contents were deleted; Worker, application and both namespaces were removed and absence verified at `2026-10-05T21:32:18.788Z`. Local diagnostic secret files were removed. Report flags: `passed: true`, `cleanupVerified: true`.
- **Private receipt:** `.wrangler/cloud-agent-infrastructure/workspace-A6Nmfg/report.json` in the active workspace checkout; log `/tmp/restyle-workspaces-live-1.log`. The portable evidence above is sufficient when these ignored files are unavailable. Do not recreate paid resources to replace a missing local receipt.
- **Cost:** bounded by the approved US$1 batch; exact billed cost was not retrieved. One run used; stop-after-success ends this batch.
- **Roadmap:** no additional checkbox yet. The provider portion of 1C.02/1C.03/1C.09 is verified; connect saved-task claims, accounting, Stop and recovery next. Model construction and trusted service tests remain later work.

