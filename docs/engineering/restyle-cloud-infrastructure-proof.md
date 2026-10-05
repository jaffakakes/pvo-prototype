# Restyle cloud infrastructure: working proof

**Roadmap 1A passed on 5 October 2026.** A real cloud computer wrote and tested a small service. We saved that service, stopped and deleted the computer, and called the service successfully afterward.

## What this means in plain English

Restyle can use a temporary computer as its workshop and keep the finished work running somewhere else. The workshop does not have to stay switched on.

The test used a fixed program that doubles a number. Linux wrote its source file, ran a test, and saved the result. The separately hosted copy returned **42** from **21**, including after the complete workshop deployment was removed.

This completes the infrastructure check. Restyle's AI does not yet have these tools in the editor. **Next is 1B: save each building task, its progress, and its follow-up questions.** Giving the model the tools to write and repair new code is 1C. Connecting its finished service to a component is 1E.

## The selected setup

| Part | What it does | Selected Cloudflare service |
| --- | --- | --- |
| Temporary workshop | Runs a real Linux program with a filesystem and Node.js | Native Durable Object Container API, managed Debian image, `lite` instance |
| Saved work | Keeps the source and test result outside the temporary computer | Private Durable Object storage, plus a local evidence copy |
| Finished service | Loads the saved source at a stable address independently of the workshop | Dynamic Workers behind a separate Worker, with its own Durable Object storage |
| Test controller | Creates the deployments, runs the checks, and removes its resources | Local diagnostic command and private resource journal |

The user enabled Workers Paid. The container account check now succeeds, and both native Linux execution and Dynamic Workers were verified in that account. Workers for Platforms dispatch remains unavailable; the selected setup does not require it. The main Restyle application, its domain, database, stored media, and beta build were not changed.

Provider references: [native container API](https://developers.cloudflare.com/containers/api/durable-object-container/), [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/), [custom runtime limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).

## Live results

The successful run lasted **13:08:07–13:09:38 UTC**, 5 October 2026.

| Check | Observed result |
| --- | --- |
| Real workshop | Linux, Node `v24.20.0`; created a source file and passed the fixed behavior test |
| Build output | 583-byte service source, SHA-256 `adab2aa18dd045279137c4349d58f96b4818bdb7b8d7cf58d66be862b76b7b85` |
| Workshop stop | Build receipt reported stopped; native `running` was false and `inspect()` returned null |
| Saved output | Source remained readable from storage after that stop |
| Duplicate start | A second build request returned 409 and did not start another VM |
| Failed command | Deliberate exit code 7; VM stopped |
| Command deadline | Deliberately unfinished process; deadline reported `command_timeout`; VM stopped |
| Independent hosting | Service returned 42 before and after deletion of the entire workshop deployment |
| Credentials and bindings | Generated service received no authorization header and an empty environment |
| Network | External fetch was blocked in both the workshop and hosted service |
| Input and output | Oversized input returned 413; oversized generated output returned 502 |
| CPU | Endless-loop probe hit the configured 50 ms limit and returned `cpu_limit`; the next normal call worked |
| Request quota | Simultaneous calls admitted exactly the remaining allowance; the total stopped at 20 and extra calls returned 429 |
| Deletion | Saved remote source was erased, later service calls returned 410, then both Workers, both namespaces, and the container application were removed |

Build, failure, and timeout receipts measured 12,541 ms, 1,782 ms, and 2,260 ms respectively, including startup/stop overhead. These are diagnostic elapsed times, not provider billing measurements. The timeout includes VM startup and does not claim that its process ran for a full second.

### Resource record

| Resource | Identifier | Final state |
| --- | --- | --- |
| Workshop Worker | `restyle-workspace-proof-9db70afc601de748f6b24a2a` | Deleted; settings endpoint returned 404 |
| Workshop namespace and container application | `4006f1a20506443b8b3ccda79578f6c1` | Absent from their account listings |
| Service Worker | `restyle-service-proof-9db70afc601de748f6b24a2a` | Deleted; settings endpoint returned 404 |
| Service namespace | `fa6081639cf74e60ae85472dbe7a11c4` | Absent from the namespace listing |

The private receipt and saved evidence are in `.wrangler/cloud-agent-infrastructure/workspace-I6VYdL/`. The report records source hashes, limits, each execution result, deployed names, deletion results, and timestamps. Local evidence is retained; uploaded source and test storage were deleted. Local proof secret files were removed after cleanup was verified.

A second run checked the final cleanup implementation at **13:13:45–13:15:06 UTC**. All checks and cleanup passed again. Its Workers were `restyle-workspace-proof-417d05bc1b9b7b1fdb057100` and `restyle-service-proof-417d05bc1b9b7b1fdb057100`; the complete resource IDs and final source hashes are in `.wrangler/cloud-agent-infrastructure/workspace-cAxaus/report.json`. Across both full proofs there were six bounded VM starts, 40 admitted service calls, and no retained cloud resources. The conservative container-only estimate below doubles to about **US$0.000726** for both proofs if every start had lasted the full allowed minute.

The earlier basic hosting check also passed at 12:26:48–12:27:11 UTC. Its Worker was `restyle-infra-proof-0948a1b5c0b2886ea352a53f`; its receipt is under `hosting-966NC5/`. An initial basic-hosting attempt received an unexpected unmarked 404 and failed; that Worker, `restyle-infra-proof-d5d6cbbdc6cd2f43c161d978`, was also deleted and verified absent. Response markers now distinguish the actual fixture from propagation responses.

## Implemented proof limits

| Item | Bound and enforcement |
| --- | --- |
| Resources | Two uniquely named Workers, two namespaces, one container application per run; no main-app bindings |
| Concurrent workspaces | One fixed object identity; an atomic claim rejects concurrent or repeated runs |
| Workspace starts | At most three per proof: build, failure, and timeout; each can run once |
| Workspace lifetime | 60 seconds per start, with a saved cleanup alarm and a finite container entrypoint; up to 180 seconds across the three probes |
| Commands | 15-second deadline including startup; 1 second for the timeout probe; destroy the whole VM on timeout |
| Workspace allocation | Provider `lite` setting: 256 MiB RAM, 1/16 vCPU, 2 GB disk |
| Downloads and internet | Disabled; no package installation; use the supplied Node runtime |
| Saved artifact | 64 KiB maximum source/result stream; 4 KiB stderr; bounded before durable storage |
| Hosted work | 20 admitted calls; 4 KiB input and generated output; atomic counter outside generated code |
| Processing | 50 ms CPU and zero subrequests in the Dynamic Worker configuration; provider's standard Worker memory ceiling, not a custom memory setting |
| Access | Separate random 256-bit test credential for each deployment; 20-minute proof expiry; authenticated deletion remains available afterward |
| Retention | Delete all remote proof deployments and storage in the runner's cleanup path; retain a private local receipt |
| Spending | Fixed resource counts and time limits for this controlled test within the authorized US$1 variable-usage budget; no account-wide dollar cap |

The provider settings specify memory and disk allocation; this proof did not exhaust memory or disk to test the provider's rejection behavior. The command timeout was exercised live; the independent 60-second alarm is a backup, not an additional live fault-injection result. Broader generated programs, package downloads, per-creator budgets, and automatic cleanup after a controller crash need the later product lifecycle work.

### Cost

Workers Paid has a **US$5/month** base price plus applicable usage. The user purchased that plan. This test did not purchase another subscription. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/).

At the published container rates, even three full 60-second `lite` starts would be approximately **US$0.000363 for container CPU, memory, and disk**, before included allowances. Workers, Dynamic Workers, and Durable Object usage are separate. Actual recorded runs were shorter. This is a resource-based estimate, not a read of the final invoice; full billing access was unavailable. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Credentials and ownership

The platform API credential stays in the local process and Wrangler's private login store, or a privately supplied `CLOUDFLARE_API_TOKEN`. It is never passed to the Linux program, service source, model, or public response. Each deployment receives only its own temporary proof secret. The generated service runs with `env: {}`, `globalOutbound: null`, and a new request containing no caller authorization.

For the later product, deployment credentials belong in the trusted server's secret store. External account credentials and approved capabilities need the separate connection/broker work in Roadmap 2.

## Code and repeatable checks

Implementation branch: `feature/restyle-cloud-infrastructure-proof`. Review: [PR #80](https://github.com/jaffakakes/pvo-prototype/pull/80).

| Files under `scripts/checks/cloud-agent-infrastructure/` | Responsibility |
| --- | --- |
| `account.mjs`, `preflight.mjs` | Private, read-only account access and capability checks; listings never count as a live proof |
| `proof-resources.mjs` | Private resource journal, independent deployments, name-scoped cleanup, and absence verification |
| `workspace-proof.mjs` | Live test sequence and evidence report |
| `workspace-worker.js`, `workspace-execution.js` | VM lifecycle, saved artifact, command/output limits, and cleanup |
| `workspace-program.js` | Fixed Linux build fixture; model-driven generation is 1C |
| `service-worker.js`, `proof-http.js` | Immutable release storage, isolated execution, request/byte limits, authentication, and expiry |
| `hosting-worker.js`, `hosting-proof.mjs` | Smaller standalone hosting diagnostic |

With locked dependencies installed and Wrangler authenticated:

```sh
node scripts/checks/cloud-agent-infrastructure/preflight.mjs 84880ccf8f98bb789d58cbea5436a645
node --test tests/cloud-agent-infrastructure.test.mjs tests/cloud-agent-runtime.test.mjs
```

The following command **creates and deletes temporary cloud resources and may consume the account's allowance**. It requires the approved account plan; it does not buy one:

```sh
node scripts/checks/cloud-agent-infrastructure/workspace-proof.mjs 84880ccf8f98bb789d58cbea5436a645 --run
```

Each run saves its journal before deployment. Even an uncertain upload is reconciled by its exact randomly allocated names. Cleanup executes after both successful and failed checks. Read `cleanupVerified` before declaring completion.

If the local controller is killed, the VM's own deadlines still apply, but the persistent deployments must be removed using that run's recorded names and IDs. Delete the exact recorded container application, delete each recorded Worker with its private configuration and `--force`, and verify that its settings endpoint returns 404 and its namespace/application are absent from the account listings. Never use the main application's configuration. Expiry blocks proof use; it is not a promise of deployment deletion.

## Verification

`npm run check` passed: source syntax, declared dependency boundaries, adopted-file formatting, and **1,108 Node tests**. Eight focused tests cover account readiness, private diagnostics, authentication and expiry, byte limits, VM timeout cleanup, durable source after runtime restart, immutable release installation, secret isolation, blocked outbound access, atomic request limits, and deletion. Local tests do not substitute for the live cloud results above.

No editor/browser journey or beta build was run because this change adds infrastructure diagnostics and documentation without changing application behavior. The full agent-to-component journey remains Roadmap 1B–1F.
