# 1C: generated services and the temporary workshop

[Numbered roadmap](01-first-working-component.md#1c-let-the-agent-write-and-test-backend-code) · [Current progress](../restyle-cloud-agent-progress.md) · [Service contract](../../../packages/pvo-assistant/services/README.md)

## Current implementation

**All of 1C is verified.** The shared contract has a behavior agreement and a separate source package. Each operation declares its inputs, result, audience and storage access. Ordered examples describe expected results and state changes. The source package refers to the exact saved agreement digest. Contract parsing cannot grant permissions or mark a service ready.

The workspace core and saved-task integration are verified in `packages/pvo-assistant/workspaces/` and `server/assistant/workspaces/`: durable source/receipts, stable resource identity, bounded commands, global compute reservations and cleanup. See the [workspace contract](../../../packages/pvo-assistant/workspaces/README.md). Actual native Container acceptance has passed and cleanup is verified. Saved-task claim/revocation, operation/usage journals and Stop/deadline cleanup now pass local restart/RPC tests. Seven task-owned bounded tool definitions/adapters are also verified. The saved model construction/repair loop now passes local restart, actual-result, Stop and retention tests. Independent validation is now verified locally; live natural-language acceptance remains Roadmap 1F.

All nine numbered 1C tasks are checked in the owning roadmap. This document preserves their decisions and evidence; hosting and the complete live generation/hosting journey remain unfinished.

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

## Builder checkpoint and continuation

**1C.05 is verified.** The [builder contract](../../../packages/pvo-assistant/builder/README.md) records its closed decisions, immutable agreement, bounded tool batches, saved actual feedback and recovery behavior. Source is on `feature/restyle-service-builder`; current progress has the commit and delivery state. The 1,284-test local check includes a six-turn repair sequence and a full workerd restart after a command completed but before its reply returned. These use controlled model/Container effects; ordinary natural-language live acceptance remains 1F.

`TaskBuilders` persists the agreement and last decision/cursor outside the temporary computer. `TaskAttempts` commits inference usage/receipt with the validated builder decision and task checkpoint. Each tool journals its stable ID before execution. On recovery, cleanup and receipt lookup finish first; the builder consumes saved output without replay and abandons remaining calls against the old computer. Stop and retention are enforced. A tool batch may carry a review request that advances only on success; this avoids a seventh inference for a final test batch.

**1C.06 is verified:** scoped public research uses `server/web/search.js` and `read.js`, with a task-owned receipt/usage journal and a four-call task cap. It may precede the agreement. Results retain source links/time and bounded text; lost replies are unknown, exact replay charges once, and Stop/retention are enforced. No VM is used; its outbound network remains disabled and the dependency lock stays empty. No credentials/cookies/private account data are passed to research. Source text cannot authorize booking/messaging/account actions. The full local check passes 1,293 tests; live provider search availability is distinct from controlled adapter checks.

**1C.07/1C.08 are verified.** Exact owned source/agreement/package hashing, immutable artifact storage and independent saved-case execution now pass local checks. Task-owned capture/case usage and reports commit before advancing, completed cases survive restart, lost pure checks are charged/retried within existing caps, and Stop blocks late reports. Failures return to bounded repair with the same agreement. Full local check: **1,309 tests**. Successful reports advance to the separate unfinished `host` stage. Next: 1D.01/1D.02 owned inactive releases. No paid proof was repeated.


### Independent validation implementation notes

Capture the exact task-owned workspace snapshot named by review, verify its revision/source digest, bind the immutable saved agreement digest and persist canonical package bytes before execution. Keep comparisons and report writing outside the generated Worker; do not send expected outputs, credentials or any platform bindings into it. The report must identify exact agreement/package bytes and actual cases run. Missing/failed/interrupted cases cannot pass. Source and generated test files cannot write the trusted report.

Use bounded case batches within the existing task claims/tool budget, saving each result before progressing. Preserve Stop, lost-result accounting and retention. Validation failure should provide bounded diagnostics back to the builder without changing its agreement; the existing model/tool caps still apply. A passed test package is distinct from a hosted/activated service and from a ready component result. The adversarial/runtime and durable restart/Stop tests now pass; the progress file records the exact implementation and beta state.

Provider API facts checked on 5 October 2026: `load()` creates a fresh Worker; `.mjs` files can be registered explicitly with `{js: content}`; plain-string module inference only supports `.js`/`.py`. [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/). CPU/subrequest limits can be set on Worker code or its entry point. [Custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/). Explicit `globalOutbound: null` blocks HTTP/TCP egress; pass an empty environment. [Egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/). Verify actual local multi-module behavior instead of assuming Node test success proves Worker compatibility. Do not run an infinite CPU loop inside local workerd: its native production CPU enforcement is separate from a local deadline test. A new paid provider/model run still needs a concrete bounded plan.
