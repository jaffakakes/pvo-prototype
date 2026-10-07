# Node.js Container provider proof

[Contract](restyle-containers-contract.md) · [Roadmap 1G](restyle-cloud-agent-roadmaps/1g-containers.md) · [Progress](restyle-cloud-agent-progress.md)

## Current decision — Fly.io, 7 October 2026

The user selected **Fly.io** after the Cloudflare upload failures and connected their existing account. Use the existing **US$1 isolated test allowance** for the replacement proof described here; no larger subscription or production deployment is authorised. This is a change of execution provider, not a second Container product. The product still executes generated services through Dynamic Workers until the Node replacement is proved and integrated. **1G.04 remains unchecked.** Preserve all completed 1E/1F evidence and the six historical Cloudflare attempts below.

In everyday terms: Fly supplies the small computer that runs a Container's JavaScript. Restyle continues to own its saved code, records, tests and publish controls. The temporary development workshop remains separate. A running instance can disappear without deleting the saved Container.

### Packaged runtime proof — prepared 7 October

The next run stays within the existing **US$1** test allowance. It creates one journal-owned app/private network, at most one Machine at a time, and at most ten Machines during a 60-minute admission window. One trusted builder uses **1 shared CPU / 1 GiB RAM / 4 GiB temporary root filesystem**, a ten-minute watchdog and an eight-minute outside build deadline. It receives only reviewed runtime source and a separate **15-minute, app-scoped registry token**. That token is journaled before creation, excluded from the image layer, revoked after the builder and never sent to a generated-code guest. No model, workshop, public service, volume or production route is created.

The builder verifies the pinned gVisor and crane downloads before use, copies the fixed Node binary/libraries and runner into a deterministic layer, and pushes it to the exact owned app registry. Record the immutable image and source digests. Destroy the builder before running the six runtime cases and a near-limit source-delivery case in **512 MiB** disposable Machines. Require exact readiness, outside expected answers and whole-Machine destruction between cases. The remote transport observation has five seconds, including exec/response overhead; the fixed host transport still kills its exec client after three seconds and its sandbox HTTP call times out at two seconds. Whole-Machine destruction remains required. This provider measurement replaces the earlier two-second whole-transport assumption; it does not change the product contract before acceptance. No package manager or live download runs in the execution sandbox.

At published `iad` rates, ten minutes at 1 GiB plus fifty minutes at 512 MiB is under **US$0.006** compute; 2 GiB of North America outbound traffic is **US$0.04**, with rootfs/registry/account charges separate. These are conservative test estimates, not a retrieved invoice. Preserve the previous capability-attempt costs in the same US$1 allowance. Registry cleanup targets only the recorded image; record whether manifest deletion is accepted and do not claim provider blob garbage collection was verified. Destroy and verify all Machines and the app, revoke scoped credentials, and remove private temporary authentication files even on failure. A saved journal resumes cleanup only.

Prepared driver: [image-run.mjs](../../scripts/checks/node-runtime/fly/image-run.mjs). `--dry-run YOUR_ORGANISATION` performs no account action; `--run-approved-image-proof YOUR_ORGANISATION` executes this plan with private `RESTYLE_FLY_TOKEN_FILE` and verified `RESTYLE_CRANE_BIN`. `--cleanup YOUR_ORGANISATION /absolute/report.json` resumes owned cleanup. The proof does not itself enable product Node hosting or finish 1G.04.

### Current continuation: fixed gVisor probe

The user requested completion of all 1G on 7 October. Within the same US$1 allowance, test one Machine at a time to test gVisor **20260928.0**, downloaded from its official immutable release URL inside the temporary Machine and SHA-512 verified before extraction. The archive is capped at 200 MiB, expanded bytes at 1 GiB. The fixed guest watchdog is now 120 seconds to allow this one-time installation; outside-guest destruction remains authoritative. No generated source, account credential or private data is sent. Eight Machines were used in the prior closed batch. The ninth hit Fly's synchronous exec timeout during setup and was removed (`run-1Dhgsc`). The tenth downloaded and verified the archive in 5.8 seconds, then a short status request timed out during expansion; cleanup is verified (`run-KqM2EN`). The eleventh streamed verified expansion directly into extraction but a connection reset ended observation (`run-U9ekK6`, cleanup verified). The twelfth adds expansion/memory measurements, tolerates transient read-only status transport failures within the same outside deadline, and uses 512 MiB to test whether 256 MiB was insufficient. No capacity cause is established yet. No original failure is presented as a sandbox pass. The one-hour admission window and one running Machine at a time remain.

The fixed OCI configuration supplies only the pinned Node executable/libraries, an empty writable temporary directory, and sandbox-owned process/device files. Node runs as UID 1000 with empty capabilities. Explicit `network=none`, `host-uds=none`, `host-fifo=none`, `directfs=false` and `systrap` are required. No host filesystem or Docker socket is mounted. Outer Fly memory/CPU and destruction limits remain; gVisor is not configured to control host cgroups. Probe exact Node, denied public IPv4/IPv6 TCP/UDP after positive controls, inaccessible host/control files and non-root child execution. A passing capability probe still does not complete 1G.04 or product integration. Measure installation/startup before selecting this envelope.

Official [installation](https://gvisor.dev/docs/user_guide/install/), [network isolation](https://gvisor.dev/docs/user_guide/networking/) and [filesystem](https://gvisor.dev/docs/user_guide/filesystem/) references were checked on 7 October. The current multi-file release includes required sidecar binaries; a legacy standalone binary is not substituted. Local archive download timed out and its partial file was removed; no unchecked executable ran. This probe downloads in Fly's data centre instead.

### gVisor capability result

**Passed**, journal `run-PuPPNA/report.json`, proof `f958559138dd9e7e95b9f897`: one 512 MiB Machine ran exact Node 24.20.0 and a non-root child in the fixed sandbox. Four public TCP/UDP IPv4/IPv6 probes were denied after their outside positive controls; capabilities were zero, no-new-privileges set, privilege regain denied and host/control paths absent. All twelve Machines in this capability sequence have verified cleanup. Earlier failed runs remain in progress; success at 512 MiB does not establish the precise cause of failures at 256 MiB.

Measured archive installation **27,538 ms**; full fixed probe **41,039 ms**. Package the immutable sandbox/runner in a trusted build so viewer cold starts do not repeat that download/installation. The six full runtime cases, canonical package/runtime replacement and integration gates are still pending. This proof is not a completed 1G.04. Current source checks pass **1,556 tests**, 875 syntax / 936 dependency / 598 formatting. The current one-hour test credential still needs revocation when work ends; preceding token cleanup evidence remains historical.

### Fly test plan and recovery

- [Diagnostic driver](../../scripts/checks/node-runtime/fly/run.mjs): one uniquely named `restyle-node-proof-<24 hex characters>` app in the connected personal organisation, with a matching separate private network. No production app, public IP/service, volume, model call or workshop change.
- At most **one shared CPU / 512 MiB Machine at a time**, twelve creations across a **60-minute** journaled test. Each fixed guest has a 120-second supplemental watchdog (extended for the recorded sandbox installation probe). The driver destroys and verifies each Machine before the next one. Interrupted runs resume cleanup from their private journal; the inside-guest watchdog is not an outside-guest safety boundary or a billing guarantee.
- Fly downloads the exact pinned public Node image directly; the API supplies only the small fixed runner files. No local Docker image upload is needed. Verify the provider image digest and exact Node/runner identity before sending source. Credentials and expected test answers stay outside the guest.
- First run fixed public IPv4/IPv6 TCP/UDP positive controls in the empty isolated app. Destroy that Machine, apply the proposed no-port network policy, then start a fresh Machine and require the same probes to be denied. This original empty-list proposal was **rejected by the actual API**; do not rerun it unchanged. Policy rejection or permitted traffic stops the proof before source cases. These four probes alone do not establish private-network, metadata, raw-protocol or Fly Proxy isolation. Those remaining boundaries must be established before product use.
- Then run the existing six runtime cases: exact Node/locked library, clean filesystem on the next instance, denied outbound request, outside-guest execution timeout, oversized response, and whole-instance descendant removal. Keep expected answers outside every guest. API responses are bounded and treated as untrusted.
- Record ownership before creation. Cleanup discovers uncertain creations by the recorded app and Machine metadata, preserves foreign resources, verifies destruction and app absence, and leaves uncertainty pending. A cleanup-only command cannot create replacements. No acceptance checkbox changes merely because local tests pass.
- Dated compute estimate: `iad` shared CPU / 512 MiB is US$3.69 per 720 hours, about **US$0.00513 for a full hour** with one running Machine. Root filesystem, network, other existing Restyle services, taxes and delayed provider billing are separate. US$1 remains the operational test allowance, not an instantaneous invoice cap. [Fly pricing](https://fly.io/docs/about/pricing/) and [Machine sizing](https://fly.io/docs/machines/guides-examples/machine-sizing/).

```sh
# No account access or remote creation.
node scripts/checks/node-runtime/fly/run.mjs --dry-run YOUR_ORGANISATION

# Secure local token file; never a token literal or credential in chat.
export RESTYLE_FLY_TOKEN_FILE="$HOME/.codex/secure/restyle-fly/proof.token"
# Fixed namespace capability only; no generated service execution.
node scripts/checks/node-runtime/fly/run.mjs --run-approved-namespace-proof YOUR_ORGANISATION

# An interrupted run's exact saved journal; does not authorise another run.
node scripts/checks/node-runtime/fly/run.mjs --cleanup YOUR_ORGANISATION /absolute/path/to/report.json
```

Use the actual organisation slug returned by the Machines API, not GraphQL's `personal` alias. They were verified as the same account; no ownership check was relaxed. The account connection was made through Fly's official browser sign-in and published one-time PKCE CLI flow. Its short login expired during setup, so a named organisation-scoped test token was created with a one-hour expiry. It has now been revoked after verified cleanup; both owned plaintext login/test token files are removed. Its private credential is outside the repository and every Machine. On another computer, use official `fly auth login` and a short-lived appropriately scoped token; this Mac's local credential is not portable. The Fly CLI downloads stalled locally; the proof uses HTTPS Machines API calls directly. See [Apps](https://docs.fly.io/machines/api/apps-resource), [Machines](https://docs.fly.io/machines/api/machines-resource), [network policies](https://docs.fly.io/machines/guides-examples/network-policies), [tokens](https://docs.fly.io/security/tokens/) and [published login protocol](https://github.com/superfly/fly-go/blob/main/cli_session.go).

### Fly evidence — 7 October 2026

Full local verification passes **1,555 tests**, 873 syntax, 936 dependency and 596 formatting checks. Provider journal `run-9PdanG/report.json` under `.wrangler/fly-node-proof/` passed exact image/Node/runner readiness and all four public TCP/UDP IPv4/IPv6 positive controls. The next API request rejected the empty-port policy with **400, at least one port is required**. The driver stopped before generated source and verified Machine/app destruction. This invalidates that policy configuration.

The fixed namespace capability probe subsequently passed in **`run-9wpw2L/report.json`**, proof `a9c315bc0e2ae1765b4542c8`. The same four positive controls passed outside the namespace; all four failed inside it. Node and its child ran as UID/GID 1000; all five capability sets were zero, `NoNewPrivs=1`, privilege regain and `nsenter` attempts failed. The probe uses separate mount/PID/network/IPC namespaces and a private `/proc`. This is capability evidence only: it has not established filesystem isolation, safe local communication, parent descriptor isolation, metadata denial, raw/VSOCK/other protocol restrictions or every escape route. **No full generated Node runtime case has passed on Fly.**

Eight Machines were created across setup/transport/capability attempts; all have verified destruction. The final authenticated organisation inventory at **11:14:23 UTC, 7 October** confirms zero diagnostic apps, `tiny-trader` absent and the unrelated `lumo-backend-chrisbec` preserved. The test token was revoked through Fly's API and both owned plaintext token files removed. Private receipts retain metadata only. Read [progress](restyle-cloud-agent-progress.md) for journals, the two corrected final diagnostic failures and the authorised unused-app deletion. No final provider invoice is claimed.

Transport uses the published Go `cmd` field, quoted fixed arguments and bounded base64 chunks because the tested exec path did not deliver stdin. Each chunk stays below Linux's per-argument byte ceiling; maximum accepted request delivery still needs provider acceptance. Readiness waits for creation to settle and retries short transport timeouts within the original startup deadline. Credentials and expected results never enter the VM.

**Exact next investigation:** design/prove the complete Node execution envelope while retaining Fly Machines as the outer cleanup boundary. Prefer an established sandbox; gVisor is researched only and is not installed or selected. Basic unprivileged namespaces are insufficient evidence on their own. Any changed envelope must be independently tested and bound into immutable runtime identity before use. Preserve the existing service/task/draft/storage/attachment authorities. Do not rerun the rejected empty-port policy or claim the six runtime cases passed. Eight of twelve Machine attempts in this US$1 diagnostic batch are used; no live resource or usable local test credential remains.

## Historical Cloudflare plan and evidence

US$1 was approved at 08:09 UTC, 7 October for the original diagnostic. Six preparation/upload attempts stopped before any Worker/application/namespace creation and zero Node runtime cases ran. Owned upload processes, credentials and registry cleanup were verified; unreferenced blob collection and final billing were not established. The final HTTP/1.1 upload also failed. The following plan and records describe those attempts, not the currently selected provider.

### Original reviewed runnable plan

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
# Use the reviewed crane 0.22.1 binary; another agent can install the same version on its host.
export RESTYLE_CRANE_BIN="$PWD/.wrangler/tools/crane-v0.22.1/crane"

# Read-only account checks plus local build/archive/digest; no upload or paid execution.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --dry-run

# Only after this proof's explicit approval; prints its private report path first.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --run-approved-node-proof

# Recover an interrupted deployment using its exact journal; cannot create resources.
node scripts/checks/node-runtime/run.mjs 84880ccf8f98bb789d58cbea5436a645 --cleanup /absolute/path/to/report.json
```

The journal saves ownership, expiry, names and an attempted-upload flag before remote mutation. Docker builds and exports locally. The pinned crane 0.22.1 CLI uploads through the host network with temporary registry credentials and a thirty-minute transfer deadline inside the diagnostic lifetime. The driver owns command groups and compares local archive and remote digests before deploying the immutable image reference. Wrangler no longer launches the remote Docker upload. Timeout is a failure even when a wrapper exits zero. Cleanup revokes execution and destroys guests, then removes the application, Worker and namespace, discovers uploaded tags only in the pre-recorded unique repository, deletes them and verifies absence. A lost upload/deletion response is reconciled by identity; failed inspection keeps cleanup pending. Only after all owned resources are absent are local diagnostic secrets removed. Local logs/journals retain evidence. The local image cache can remain for further tests; it has no running compute charges.

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
| Upload retry `3e382dce0a1bec8557d0ad52` | Same US$1 allowance | No Worker/application/namespace; Docker transfer timed out | Exact orphan push PID 84307 stopped; journal reopened and cleanup reverified. `.wrangler/cloud-agent-infrastructure/workspace-aNuEpQ/report.json`. Zero runtime cases. |
| Supervised preparation `a6640c1769252c957eef4d8a` | Same allowance; no remote upload | Local Docker plugin lookup failed | Corrected and locally built successfully; resource inventories empty. `.wrangler/cloud-agent-infrastructure/workspace-CAB14R/report.json`. |
| Supervised Docker upload `aabd63702deec2c3219e46ea` | Same US$1 allowance | Image transfer failed before Worker/application/namespace | Docker Desktop network connection closed during the 50.8 MB Node layer. Process absent; registry/resource/credential cleanup verified. Journal `workspace-eiEg5u/report.json` under the same private directory. |

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

## Host-network uploader preparation — 7 October 2026

The first direct upstream CLI download timed out. The Homebrew arm64 Tahoe 0.22.1 bottle was then downloaded and its published SHA-256 checked (`52b52a75d91903ce0526e221a68b366f26ade0bf6cd6cedcc5907bcb2ad0c31e`) before extracting only crane into the checkout's ignored tools folder; no global installation. [Upstream installation](https://github.com/google/go-containerregistry/tree/v0.22.1/cmd/crane) and [push format](https://github.com/google/go-containerregistry/blob/v0.22.1/cmd/crane/doc/crane_push.md) describe the supported archive upload. The runnable proof requires that exact version, uses stdin for login, redacts URL query tokens, and removes credentials/archive after success or failure.

Expanded dry run `.wrangler/cloud-agent-infrastructure/workspace-UmWuf0/report.json` verifies the actual tool, local image build, archive and digest, then the Worker bundle without upload: `dryRunPassed:true`, `attempted:false`, `cleanupVerified:true`. Full **1,545 tests** pass; `/tmp/restyle-node-host-upload-{dry-run,full}.log`. No hosted Node test or roadmap completion is claimed from this preparation.

### Host HTTP/2 transfer failure

Run `49dd6f6fbd17f3768631571c`, journal `.wrangler/cloud-agent-infrastructure/workspace-O5pPHN/report.json`, failed on the large blob with a peer HTTP/2 protocol error before deployment. Initial namespace inventory timed out; cleanup-only recovery verified absence at 09:05:46 UTC. The next diagnostic selects HTTP/1.1 for crane using Go's [documented HTTP/2 switch](https://pkg.go.dev/net/http#hdr-HTTP_2); TLS and certificate verification remain enabled. Three focused transport/process checks pass. No Node case or task completion is claimed.


## Final HTTP/1.1 transfer outcome

Run `e91b5fb3ee3cdbef090e4316`, journal `.wrangler/cloud-agent-infrastructure/workspace-YaTlya/report.json`, ended with repeated `write: broken pipe` errors while uploading the large Node layer. The driver recorded the original failure before cleanup. All owned resource/image inventories and local credential/archive removal were verified at **09:16:37 UTC, 7 October 2026**; driver/upload processes are absent. No Worker/application/namespace or Node test execution occurred. The six recorded attempts therefore provide no hosted runtime acceptance. Provider-managed unreferenced blob collection and final billing remain outside these observations.

## Provider reassessment — 7 October 2026

The user explicitly says Cloudflare is optional and asks what works with Node.js. This is a researched shortlist, not a new implementation contract or a claim that a substitute has passed Restyle's acceptance tests.

| Candidate | Documented capability | Restyle-specific work still required |
| --- | --- | --- |
| [Modal Sandboxes](https://modal.com/docs/guide/sandboxes) | Designed for untrusted user/agent code. Can use [public registry images](https://modal.com/docs/guide/existing-images), including a pinned Node runtime, with [outbound network blocking](https://modal.com/docs/guide/sandbox-networking). | Verify callable control API from the existing Cloudflare coordinator, immutable base/runner identity, launch/stop reconciliation, full guest cleanup, pricing and latency. Its JavaScript SDK documents Node/Deno/Bun support; do not assume Workers compatibility. A sandbox instance is temporary; Restyle retains service identity/code/data outside it. |
| [Fly Machines](https://docs.fly.io/machines/overview) | API-controlled virtual machines; [Node.js support](https://docs.fly.io/js) and [remote image builds](https://docs.fly.io/reference/builders). | Prove generated-code network restrictions and owner isolation as well as exact image, termination, replay and cost controls. Plain ability to host Node does not complete those gates. |
| [Render](https://render.com/docs/deploy-node-express-app) | Managed Node.js web services built from source. | Good conventional server hosting candidate; separately establish whether its control and isolation model fits per-owner generated-code execution before selecting it for that role. |

**Recommendation for evaluation:** Modal is a promising next candidate because its documented sandbox controls match the isolated execution role. This is an architectural judgment, not a provider benchmark or final selection. Keep the current service registry, saved drafts, durable data, independent expected results and component protocol; replace the compute effect and its accounting/cleanup integration if the candidate passes. Do not add a parallel Container product or move all of Restyle solely to change generated-code execution.

Cloudflare also documents [default-policy public registry images](https://developers.cloudflare.com/containers/guides/image-management/) and [native start/exec/network controls](https://developers.cloudflare.com/containers/api/durable-object-container/). Pulling an exact base image in the cloud and supplying the verified runner could avoid uploading the large runtime from this Mac. That design has not been implemented or tested. The observed failures establish a transfer problem, not a general inability to run Node or a proven provider outage.

Before any replacement-provider paid test, prepare its exact executable plan, required secure account setup and dated cost estimate. The existing US$1 approval names the Cloudflare diagnostic; no funds or account signup have been transferred to another provider. Keep all six roadmap gates unchecked until their original behavior requirements pass.
