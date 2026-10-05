# Restyle cloud infrastructure: first check

Checked on 5 October 2026. This records progress on **Roadmap 1A**. The complete workspace-to-hosting proof is **not finished**.

## What works now

We deployed a small, separate service in Restyle's real Cloudflare account. Its address responded after the deployment command had finished. It required a private test credential, rejected POST requests, and returned the expected answer on a second GET. We then deleted it and checked that Cloudflare could no longer find its configuration.

This proves basic independent hosting and cleanup. The test used a fixed program from the repository. It does not yet prove that Restyle's agent can generate a backend, that a Linux workspace can run, or that a service survives that workspace stopping.

The main Restyle application, its domain, database, stored media, and beta build were not changed. No paid plan was enabled.

## What the account check found

| Check | Actual result |
| --- | --- |
| Existing Cloudflare credentials | Wrangler authenticated against the configured Restyle account. |
| Workers address | Available; the disposable deployment also worked. |
| Linux container workspaces | Rejected. Cloudflare's response specifically required Workers Paid. |
| Workers for Platforms dispatch | Rejected with code 10121: the account does not have dispatch access. |
| Full subscription details | The connected API denied that read. We have not inspected the account's complete bill. |

The repeatable account check returns a failing exit status when the original provider combination is unavailable. It never treats an API listing as evidence of successful code execution.

## The next account decision

**Recommended next step: enable Workers Paid, then test a Linux workspace and Dynamic Workers.** Workers Paid starts at **US$5 per month**, with additional usage charges. Both container workspaces and Dynamic Workers require that plan. This is a proposal until the account change is approved and the live tests pass. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Sandboxes](https://developers.cloudflare.com/sandbox/), [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/).

The original architecture listed Workers for Platforms as a hosting candidate. Its separate advertised plan is **US$25 per month**, plus overages. It remains an option if the later service-management requirements justify it. We have not purchased it. [Workers for Platforms pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/).

Dynamic Workers provide another way to load separately stored creator code into an isolated runtime. A stable Restyle address would look up an immutable release and load it using a stable release identifier. The build workspace would be independent of that lookup. This is a design inference from the current API; the account-specific deployment, limits, persistence, and cleanup still need testing. [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/).

Cloudflare's current instructions recommend the native Durable Object Container API for new Linux workspaces. The earlier Sandbox SDK 0.x examples are not the starting contract for this new implementation. [Container API](https://developers.cloudflare.com/containers/api/durable-object-container/).

## Code added

The implementation is on `feature/restyle-cloud-infrastructure-proof`, based on `origin/dev` at `19cd065`.

| File under `scripts/checks/cloud-agent-infrastructure/` | Purpose |
| --- | --- |
| `account.mjs` | Read-only account access, using an existing private token or Wrangler's saved login. It keeps credential output out of reports. |
| `preflight.mjs` | Check hosting, container, and dispatch access independently and report unavailable capabilities. |
| `hosting-worker.js` | Fixed, credential-protected test service with an expiry. It accepts no uploaded code or writes. |
| `hosting-proof.mjs` | Give the service a unique name, deploy it, check actual HTTP results, delete it, and verify its absence. |

The hosting command saves a private resource journal **before** deployment. An interrupted upload may already have created a resource. Cleanup runs on both success and failure. If the process is killed before cleanup, the journal records the exact name and account needed for recovery. Expiry disables successful proof calls; it does not delete the Worker.

The platform API credential stays in the local process and Wrangler's private credential store. Only a freshly generated test credential goes into the disposable Worker as a secret. It is never sent to a model or written into the fixture source. Generated service code will need a separate credential broker in Roadmap 2.

## Repeat the checks

From the implementation checkout, after installing the locked dependencies and signing into Wrangler:

```sh
node scripts/checks/cloud-agent-infrastructure/preflight.mjs 84880ccf8f98bb789d58cbea5436a645
node --test tests/cloud-agent-infrastructure.test.mjs
```

The following command **creates and deletes a temporary Cloudflare Worker**. It uses the account's current plan and can consume its allowance. It does not buy a subscription:

```sh
node scripts/checks/cloud-agent-infrastructure/hosting-proof.mjs 84880ccf8f98bb789d58cbea5436a645 --run
```

Reports and temporary configuration live in ignored `.wrangler/cloud-agent-infrastructure/hosting-*/`. The local secret file is removed when the command finishes. Read the report's `cleanupVerified` field, rather than assuming a failed command created nothing.

For an interrupted run, use its journal's exact configuration path to delete that specific Worker, then verify it is absent through the account API:

```sh
npx wrangler delete --config <journal-directory>/wrangler.json --force
```

## Limits

The existing hosting probe has these implemented bounds:

| Item | Bound and enforcement |
| --- | --- |
| Resources created | One uniquely named Worker per command. The recorded name is checked for absence before upload. |
| Successful service availability | Ten minutes; enforced by the Worker using server time. |
| Test requests | At most twelve readiness attempts and three later checks, controlled by the diagnostic command. This is not an account-wide request quota. |
| Incoming work | Only a fixed GET operation; no caller-provided program, package download, storage, or outgoing request. |
| Network wait | Fifteen seconds per account read; ten seconds per service call. |
| Deployment and deletion | Each command has a two-minute deadline. The journal retains an uncertain deployment for cleanup. |
| Credential exposure | A dedicated 256-bit test credential; no main-app credentials or bindings in the service. |

Use these starting limits for the **next controlled Linux proof**. They have not been implemented or verified yet:

| Item | Selected test limit | Required enforcement |
| --- | --- | --- |
| Concurrent workspaces | One | A platform-owned coordinator; repeated starts use the same task identity. |
| Workspace execution | 60 seconds total; 15 seconds per command | Container lifecycle deadline, process timeout, and independent cleanup alarm. |
| Workspace size | `lite`: 256 MiB RAM, 1/16 vCPU, 2 GB disk | Provider instance setting. |
| Package downloads and external network | Zero for this proof | Disable container Internet access; use the supplied Node runtime. |
| Saved source and result | 64 KiB combined | Check bytes before writing outside the workspace. |
| Generated service requests | 20 accepted calls; 4 KiB input and output | Trusted gateway counter and byte limits. |
| Generated service processing | 50 ms CPU per call; 128 MiB runtime ceiling | Provider resource settings; verify actual rejection behavior. |
| Retention | Delete the test's source, saved results, workspace, and service after verification | Resource journal and verified cleanup. |
| Spending | No subscription change without approval; at most US$1 of variable usage budgeted for the controlled test | Bound resources before starting and reconcile usage afterward. A complete billing cap is not implemented. |

The memory and disk allocation come from Cloudflare's documented `lite` instance. Dynamic Worker CPU limits must be checked against its current resource-limit API before deployment. These limits are for proving the infrastructure; package installation and broader workloads need their own limits in later milestones. [Container sizes](https://developers.cloudflare.com/containers/platform/limits/), [Dynamic Worker resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).

## Evidence and remaining work

Successful hosted run: **12:26:48–12:27:11 UTC**, 5 October 2026.

- Worker: `restyle-infra-proof-0948a1b5c0b2886ea352a53f`.
- Result: authenticated GET returned the expected identifier and answer `42`; unauthenticated GET returned 401; POST returned 405; repeated GET returned the same result.
- Source SHA-256: `62f46c4e3adbea44c69a6ea2a52e6977ccad4ffc6e8187ac7c2457bdefcd387a`.
- Cleanup: the Worker settings endpoint returned 404 after deletion.
- Private receipt: `.wrangler/cloud-agent-infrastructure/hosting-966NC5/report.json`.

The first attempt, `restyle-infra-proof-d5d6cbbdc6cd2f43c161d978`, failed its POST check after receiving 404. Cleanup passed for that attempt too. We added a per-run response marker to distinguish the deployed fixture from an infrastructure response. The successful run observed an initial unmarked 404, then the marked responses above. Propagation is a likely explanation for the first failure; that first response did not have enough diagnostics to establish its cause conclusively.

Verification completed: `npm run check` passed, including syntax checks for 510 source modules, declared dependency boundaries for 703 modules, formatting for 121 adopted files, and all 1,104 Node tests. The four new focused tests cover unavailable access, malformed/network responses, credential redaction, and the fixture's authorization, expiry, and allowed operation. They do not execute a cloud container. The first full check found missing generated WASM in the fresh checkout; `npm run build:language` supplied that prerequisite and the complete rerun passed. Local documentation links and the real hosted run above also passed. No editor/browser journey or beta build was run: the changes add infrastructure diagnostics and documentation, without changing application behavior.

Still required to finish 1A:

1. Enable the approved plan and recheck account access.
2. Implement the selected workspace and gateway limits above.
3. Run a program inside a real isolated Linux workspace and save its source and result outside it.
4. Stop the workspace and verify that it is stopped.
5. Call the separately hosted release from its saved source after the workspace is stopped.
6. Verify failure cleanup and remove every disposable resource, including saved artifacts.

Only then should 1A be marked complete and the saved authoring-task work in 1B begin.
