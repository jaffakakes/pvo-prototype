# Workspace provider verification plan

[Progress](restyle-cloud-agent-progress.md) · [Roadmap 1C](restyle-cloud-agent-roadmaps/1c-generated-services.md) · [Workspace contract](../../packages/pvo-assistant/workspaces/README.md)

## Status

**Prepared locally; not deployed or paid for.** The disposable diagnostic is in `scripts/checks/cloud-agent-workspaces/`. Its control flow passes against real local workerd/SQLite with explicitly simulated computers. Wrangler's deployment dry run passes with one Container class and a separate budget class. This is preparation, not a real provider result.

The earlier US$15 approval covered the completed 1B provider-recovery batch. A new bounded workspace test batch needs its own cost decision before deployment. Local implementation can continue meanwhile. The proposed ceiling is **US$1 in additional variable usage for at most two runs**; stop after the first passing run. Record the user's decision here and in progress before running it.

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

## Results to record after an approved run

Record source commit and bundle hash; start/end times; exact Worker/application/namespace IDs; checks passed or failed; actual cleanup observations; whether the result changes any numbered checkbox; and the exact next task. Never substitute a successful local simulation or dry run for this section.
