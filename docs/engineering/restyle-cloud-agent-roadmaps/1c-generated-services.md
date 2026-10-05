# 1C: generated services and the temporary workshop

[Numbered roadmap](01-first-working-component.md#1c-let-the-agent-write-and-test-backend-code) · [Current progress](../restyle-cloud-agent-progress.md) · [Service contract](../../../packages/pvo-assistant/services/README.md)

## Current implementation

**1C.01/1C.02/1C.03/1C.09 are verified.** The shared contract has a behavior agreement and a separate source package. Each operation declares its inputs, result, audience and storage access. Ordered examples describe expected results and state changes. The source package refers to the exact saved agreement digest. Contract parsing cannot grant permissions or mark a service ready.

The workspace core and saved-task integration are verified in `packages/pvo-assistant/workspaces/` and `server/assistant/workspaces/`: durable source/receipts, stable resource identity, bounded commands, global compute reservations and cleanup. See the [workspace contract](../../../packages/pvo-assistant/workspaces/README.md). Actual native Container acceptance has passed and cleanup is verified. Saved-task claim/revocation, operation/usage journals and Stop/deadline cleanup now pass local restart/RPC tests. Model tool advertising and construction remain pending.

The remaining numbered tasks are unchecked. This document records decisions for their code and tests; the model-driven build and independent test approval are still unfinished.

## What the creator should experience

The creator asks for a feature and answers relevant questions. The agent saves what the feature should do, writes its program in a private temporary computer, runs tests, and corrects failures. Closing Restyle does not erase the task. Stop prevents more work and shuts down the computer. The saved code and results remain available for recovery. Finished service hosting is a separate milestone, so the temporary computer never becomes the component's permanent address.

## Responsibilities and sequence

| Tasks | Owning code | Concrete work and completion evidence |
| --- | --- | --- |
| 1C.02/1C.03 | New `server/assistant/workspaces/` adapters; narrow task integration | A stable owned workspace identity, durable source outside the Container, one active execution, idempotent lookup/start, restoration after loss, Stop tombstone and cleanup alarms. Exercise full local coordinator restart and a bounded real Container proof. |
| 1C.04 | Workspace tool adapters plus shared bounded tool contracts | Read/write only declared source/test paths, bounded commands/output, actual exit status and saved reports. A missing provider disables its advertised tool. Tools cannot select platform ownership or receive credentials. |
| 1C.05 | Separate saved builder loop under `server/assistant/` | Save the behavior agreement before the first generated source. Reuse task claims, operation/usage journals and model adapters. Save each actual tool result before requesting the next model decision. Repair from errors; do not treat a model's success message as evidence. |
| 1C.06 | Workspace network policy and existing public research adapter | Start with no outbound network and an empty dependency lock. Use scoped public research when needed. Do not enable unrestricted Internet to make installation convenient. Add controlled package resolution only when a real dependency is needed. |
| 1C.07/1C.08 | Trusted execution/test adapter outside the build VM | Hash exact source and agreement bytes; run saved behavior cases against the isolated hosted runtime; validate every input/result/state. Save a platform-owned report bound to both identifiers. Generated tests are supplementary feedback. |
| 1C.09 | Workspace lifecycle and task cleanup integration | Stop/deadline/failure terminates the whole Container, including command descendants; preserves saved source/results; records unknown cleanup and retries with bounded backoff. No delayed command can revive a stopped task. |

Keep the numbered checkboxes authoritative. These groups can share a cohesive implementation branch, but must not be checked together unless each has its own evidence. The user authorized local continuation without GitHub checks on 5 October. The workspace branch starts at current dev and combines the already tested prerequisite heads locally; remote integration is separate and must not delay implementation.

## Workspace identity and restoration

Derive the provider identity in trusted code from the saved owner, project and task. Source revisions and container restarts must not create another logical workspace. Record intent, resource identity and limits before starting anything. A lost start reply is reconciled by looking up that same identity.

A Durable Object stores the workspace record and bounded source files outside the ephemeral filesystem. A filesystem snapshot supplied by the Container is unnecessary for the initial dependency-free package. Durable source is authoritative; restore it into a fresh filesystem after interruption. The task's immutable behavior agreement lives outside writable generated files.

Keep provider lifecycle state distinct from task state. Record a starting/restoring/command operation before dispatch, and reject late results unless its revision and task claim still match. If a process could still be running after a coordinator interruption, stop the owned Container before replaying work. Stop closes the identity before cleanup, so a late start cannot recreate the resource. Missing lookup, confirmed absence and failed lookup are different outcomes.

Do not delete an unresolved cleanup obligation just because ordinary task retention expires. Use the existing provider journal's treatment of uncertain outcomes as a reference, while keeping workspace-specific rules in their own module.

## Limits and untrusted code

Choose concrete command/startup time, active workspace duration, output bytes, concurrency and daily usage limits in platform code before connecting the tools. Preserve the existing per-task tool/model reservations; any change to those caps must be explicit and tested. Add a global reservation boundary so multiple owners cannot each consume unbounded compute. No model-supplied limit increases.

The Container has no platform keys, creator sessions or another task's files. It initially has no outbound network or public route. Filesystem reads/writes must enforce containment and reject symlinks, even though the shared path contract already rejects traversal. Source captured from a command is untrusted and revalidated before storage. A VM report or generated file saying `passed` is not a platform receipt.

**Provider facts checked on 5 October 2026:** the native Container API can start a managed image, inspect it, run commands and destroy it. Execution supports streams and a working directory; streams must be read with bounds. Process signals do not stop descendants. Under the durable-object scheduling policy, selecting a Linux user does not remove root capabilities. Therefore user IDs/file permissions cannot protect test authority inside the same VM. Use outside lifecycle enforcement and a separate trusted test runner. [Cloudflare Container API](https://developers.cloudflare.com/containers/api/durable-object-container/).

## Trusted test gate

Use the saved agreement and exact saved package, not whichever files a previous command leaves behind. The platform wrapper calls the package's `execute` export with trusted state/time and checks the returned shape, read/write rule and expected result/state. A test report identifies the agreement digest, source digest, platform checks and actual cases run. Missing/failed cases prevent readiness.

The dinner and equipment examples remain fixtures. The model must generate their different rules from ordinary requests during the full acceptance run. No production switch on feature name, canned source template, skipped failure, or generated report file can substitute for that demonstration.

The existing 1B inactive-release adapter has smaller diagnostic input/output limits and accepts one JavaScript module. Adapt that boundary deliberately when adding the product's multi-file test/runtime loader; update source, fixtures and documentation together. Do not silently treat Node test success as proof of Workers runtime compatibility.

## Verification before checking the remaining tasks

Exercise owner/task isolation; concurrent starts; lost start/command replies; actual process failure; startup/command timeouts; bounded output; Stop during restoration and execution; restart from saved files; stale snapshots; wrong source/agreement digests; generated attempts to forge a pass; malformed outputs; and cleanup failure/recovery. Distinguish fake adapter tests, real local workerd persistence and actual provider evidence.

Before any new paid acceptance run, record exact resource names, count, lifetime, call bounds, expected charges and cleanup responsibility. The approved US$15 recovery batch is already complete; do not silently reuse its approval for a new Container/model batch. Complete local code and tests first so any remaining spending decision is concrete.

The [workspace provider verification plan](../restyle-workspace-provider-proof.md) records the prepared disposable diagnostic, limits, proposed test ceiling and cleanup procedure. The first approved real provider run passed on 5 October 2026; all disposable resources were removed and their absence verified. The evidence records the exact source, bundle and resources.
