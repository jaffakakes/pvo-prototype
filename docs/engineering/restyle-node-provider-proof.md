# Node.js Container provider proof

[Contract](restyle-containers-contract.md) · [Roadmap 1G](restyle-cloud-agent-roadmaps/1g-containers.md) · [Progress](restyle-cloud-agent-progress.md)

## Status — 7 October 2026

**US$1 approved by the user at 08:09 UTC, 7 October 2026**, for the single diagnostic deployment below. **1G.04 is unchecked.** The first upload stopped before resource creation; no runtime case passed. A corrected runner will retry within the same allowance. The existing product still runs generated services through Dynamic Workers. Preserve its completed 1E/1F evidence. This proof cannot by itself complete the replacement, manual publication, component connection or final beta acceptance.

In everyday terms: first verify that a disposable hosted computer can run the exact saved JavaScript, return an answer, and disappear without leaving private files or background programs behind. Then connect that proven execution effect to the existing service and independent tests.

## Reviewed runnable plan

- Use [the existing resource journal](../../scripts/checks/cloud-agent-infrastructure/proof-resources.mjs) with [the Node diagnostic](../../scripts/checks/node-runtime/run.mjs). One uniquely named diagnostic Worker, one Container application, one SQLite namespace and one uniquely owned runtime-image repository. No production route, model calls, external volume or app configuration changes.
- Run at most two instances through exactly two private controller IDs. Cloudflare's Durable Object-managed policy rejects `max_instances`; the fixed slot selection and durable lease enforce concurrency. No public route accepts another slot name.
- Stop admitting new work after 60 minutes. Maximum 100 starts across this diagnostic's lifetime, enforced as 50 per slot including earlier UTC days. Each guest lease is at most 45 seconds, with 30-second readiness, 2-second execution and 5-second cleanup attempts. An uncertain destroy retains the slot and its durable cleanup alarm.
- Use Node **24.20.0**, Linux/amd64 base **`node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa`** and the runner digest in [runtime.js](../../server/cloud-services/node/runtime.js). Provider image identity, Node version and runner bytes are checked before source execution.
- Only the three guest files enter the Docker build context. Checked nanoid **5.1.6** bytes and its MIT notice are retained in source; tarball SHA-512 was verified before extraction. Changed or unsupported lock bytes fail before admission. No installation scripts or package downloads occur inside a guest.
- Disable guest Internet access. Keep credentials, databases, expected test answers and lifecycle authority outside it. The generated reply is untrusted. The controller bounds input/output and destroys the entire instance, including descendants, before reuse.

The initial run checks exact Node/library execution; a later fresh guest cannot see an earlier temporary file; outbound network is denied; an infinite loop times out; oversized output is rejected; spawned children disappear with the guest. Each case verifies no remaining instance/lease. Independent validation, durable service data/replay, owner/test/live separation, pause/delete and lost publication/control responses are subsequent integration cases under the same numbered tasks; do not claim them from this first runtime probe.

## Cost and approval

Approved authorization: **one diagnostic deployment, up to US$1 estimated total**, within the above 60-minute/100-start bounds. This is a bounded test allowance, not a model-turn or overall goal limit. The conservative compute estimate uses two provisioned lite instances for the full hour (approximately US$0.01451 at the rates recorded in the contract); actual short invocations should be lower. Worker/Durable Object operations, registry/storage and networking add costs. Provider billing may arrive later; the allowance is an operational estimate, not an instantaneous invoice cap.

The Container contract requires scoped approval after preparing the executable plan. Earlier 1F spending is closed and does not fund this distinct test. The user has now explicitly approved US$1. Run the prepared diagnostic once within these bounds, record its journal before effects, verify cleanup, and use the provider evidence for the next implementation decision. This approval is separate from the closed 1F spending.

## Commands and recovery

Run from the active source checkout. Credentials are read from the existing secure local Cloudflare setup; never paste them into chat or these documents. The account ID is public configuration.

```sh
# Read-only account checks plus local build; no deployment or paid execution.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --dry-run

# Only after this proof's explicit approval; prints its private report path first.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run-approved-node-proof

# Recover an interrupted deployment using its exact journal; cannot create resources.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --cleanup /absolute/path/to/report.json
```

The journal saves ownership, expiry, names and an attempted-upload flag before remote mutation. Cleanup revokes execution and destroys guests, then removes the application, Worker and namespace, discovers uploaded tags only in the pre-recorded unique repository, deletes them and verifies absence. A lost upload/deletion response is reconciled by identity; failed inspection keeps cleanup pending. Only after all owned resources are absent are local diagnostic secrets removed. Local logs/journals retain evidence. The local image cache can remain for further tests; it has no running compute charges.

## Evidence so far

- Local Docker proof: six cases passed; all six containers removed. Apple Silicon amd64 emulation needed one CPU locally. The initial 1/16 CPU run timed out and was removed. This does **not** prove provider lite readiness/performance. Receipt `restyle-node-proof-hlTnvj/report.json` in the OS temporary directory; `/tmp/restyle-node-local-proof.log`.
- Fourteen final focused tests pass: real workerd/SQLite admission/replay/metering/restart/cancellation/uncertain destruction; exact library admission; outside-guest byte/UTF-8/runtime checks; bounded recovery-only image cleanup. `/tmp/restyle-node-all-focused.log`.
- Wrangler local deployment dry-run passed for journal `.wrangler/cloud-agent-infrastructure/workspace-t0WAAb/report.json`, proof ID `b7b2ffc2440bab0d1c4071ce`. Registry inventory confirmed its unique image name unused. `attempted:false`, `dryRunPassed:true`, `cleanupVerified:true`; no upload, instances or namespaces were created. Initial dry-run configuration failures are recorded in progress.
- Full `npm run check` passed 1,512 tests, 837 syntax / 908 dependency / 545 formatting checks; strict editor types pass. Final cleanup-lock correction is covered by the fourteen focused tests above.
- Follow-up source `ebcd318` checkpoints independent test steps and distinguishes startup/transport failures; full **1,516 tests**, types, browser recovery and combined beta checks pass. Current beta is **`restyle-editor-shell-c7c37ca0cfe361da`**. The Node execution adapter remains unwired; no hosted Node runtime or production deployment is claimed.

## Resource register

| Run | Authorization | Remote creation | Outcome / cleanup |
| --- | --- | --- | --- |
| Initial upload attempt `6a0868727a1b5ab1fb09b420` | US$1 approved, 7 October 08:09 UTC | No Worker/application/namespace/image observed | CLI ended early; zero runtime cases. Exact account and corrected registry inventories empty; journal `.wrangler/cloud-agent-infrastructure/workspace-wulZFc/report.json`. |

After the paid run, record its exact journal, runtime image digest, start/elapsed usage, checks and cleanup result here before marking any roadmap task. Full task completion also requires the canonical Node package/runtime replacement and its remaining integration gates.

Provider references: [Container lifecycle API](https://developers.cloudflare.com/containers/api/durable-object-container/), [image management](https://developers.cloudflare.com/containers/guides/image-management/), [image cleanup commands](https://developers.cloudflare.com/containers/reference/wrangler-commands/) and [pricing](https://developers.cloudflare.com/containers/platform/pricing/), checked 7 October 2026. Provider documentation describes capabilities; only the recorded executions establish proof.


### Local cleanup race follow-up

The dependency/update full suite exposed a maintenance alarm aborting an already-completed execution while its guest destruction was pending. The controller now aborts overdue running work only; a successful result waits for existing cleanup confirmation. Explicit cancellation continues to reject late results. A deterministic held-destruction/alarm regression and all fifteen Node runtime tests pass (`/tmp/restyle-runtime-race-fixed.log`). This is local controller evidence; the paid provider proof remains pending and no guest was created.


## Automatic retention preparation — 7 October 2026

The prepared controller now schedules future usage expiry even after its short cancellation receipts expire. It retains an unresolved compute lease and metering row through a thirty-two-day interruption and full restart, blocks replacement starts, and resumes cleanup without losing the obligation. Usage older than thirty UTC days is removed only after no lease owns it. Controlled workerd/SQLite tests pass with the existing cancellation/alarm matrix; full source checks pass **1,539 tests**. This is local preparation only: no guest/provider was created, the scoped approval remains pending, and 1G.04/08 and 4C.06 stay unchecked.


## Resource accounting preparation — 7 October 2026

The same prepared execution controller now records admitted payload bytes, returned bounded JSON bytes, starts and separately timed startup/execution/cleanup in `node_usage`. An owned read-only snapshot separates live/test/validation/probe totals, daily capacity and an unresolved lease; it starts no compute and exposes no other owner's private fields. A cleanup confirmation settles time once, even after restart; a missing confirmation remains pending. The private prepared schema changes before any Node deployment, with no compatibility path.

The proof driver retains those snapshots and a dated gross compute estimate in each result receipt. Memory/disk provisioning and an assumed full-CPU estimate use [the rechecked pricing](https://developers.cloudflare.com/containers/platform/pricing/). Reserved wall time includes startup/cleanup and can exceed billed running time. Included allowances and all non-Node charges are explicitly excluded; pending time is separate. This preparation must not be presented as a complete Container bill or as completed 4C.02.

Nineteen focused Node cases and **1,541 full behavior tests** pass, plus strict editor types. The updated diagnostic dry run passes with no attempted creation: `.wrangler/cloud-agent-infrastructure/workspace-OWODtO/report.json`, `dryRunPassed:true`, `cleanupVerified:true`. Logs `/tmp/restyle-node-metering-{tests-final,full,types,dry-run}.log`. Scope approval is still pending, no paid proof ran, and all six remaining Roadmap 1 gates remain unchecked.
