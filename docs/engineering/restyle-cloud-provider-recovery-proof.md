# Provider recovery proof — 1B.08 and 1B.09

Status: **prepared, not run on Cloudflare**. See [current progress](restyle-cloud-agent-progress.md). Local workerd exercises the actual coordinator journal and release adapter; this does not replace the live acceptance.

## Planned resources and bounds

Use the existing Workers Paid account `84880ccf8f98bb789d58cbea5436a645`. The script creates one randomly named `restyle-recovery-proof-<id>` Worker, two SQLite namespaces (`ProofTasks`, `ProofRelease`), two coordinator instances and at most two inactive releases. It does not provision Containers or invoke an AI model.

The private local journal records the actual name, account, configuration, operation identity and attempted creation **before** deployment. A private bearer token gates a fixed diagnostic; it cannot upload caller-supplied code or arbitrary commands. Access expires after 20 minutes. Each release permits 20 probes, 4 KiB input/output, 50 ms generated-code CPU and zero outbound requests. The driver permits 80 diagnostic calls, in addition to bounded health and cleanup reads. The ordinary sequence uses one dynamic code identity; the ceiling is two.

The actual task coordinator and release code are imported into the diagnostic. Only fixed input, controlled clock, deliberate loss/crash injection and proof cleanup belong to the diagnostic subclass. This does not claim model-driven generation, service activation or a browser-to-builder journey.

## Acceptance sequence

1. Reject unauthenticated access.
2. Create an inactive service, then force the coordinator to reset before recording success.
3. Read persisted state from the replacement coordinator instance.
4. Make provider lookup fail; verify no absence is invented and no second creation occurs.
5. Restore lookup; adopt the original owned identity, settle its one tool charge and replay under a new claim without another create.
6. Execute the original service, checking output 42, empty environment, missing caller credentials, denied outbound network, byte limit and actual provider CPU enforcement.
7. Stop and verify the original source is deleted while its completed receipt remains.
8. Stop a second task while its first publication is delayed. Cancel the missing identity; verify the late publication cannot resurrect it.
9. Delete both release sources and the whole disposable Worker/namespaces. Verify provider absence and remove private proof secrets. Retain non-secret evidence and exact bundle hashes.

The entry point is `node scripts/checks/cloud-agent-recovery/run.mjs <account-id> --run`. Run only after the new spending decision is recorded. The local `tests/cloud-services/proof.test.mjs` runs this acceptance sequence without the CPU spin case, because local workerd does not enforce that CPU limit. A Wrangler dry run validates the deployable bundle.

## Spending decision

**New authorization pending.** The earlier US$1 authorization covered completed 1A. Proposed ceiling for this disposable verification batch: **US$15 of additional test charges**, at most two runs under the resource bounds above. Expected metered use is much smaller and may fall entirely within the existing included allowance. No new subscription is needed.

Cloudflare lists dynamic creation at $0.002 per unique worker/day beyond the included allocation, with standard request/CPU rates. Durable Objects include monthly compute/storage allocations, but billable usage is rounded upward; crossing a duration billing increment can add $12.50. This is why a tiny resource estimate alone cannot promise a sub-dollar invoice change. No account-wide billing cap or invoice reading is claimed. Sources: [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

If cleanup fails, the local journal keeps names, IDs and private cleanup access; reconcile those exact resources before any new run. Provider-enforced expiry removes inactive source, but the namespace/Worker deletion must still be verified.
