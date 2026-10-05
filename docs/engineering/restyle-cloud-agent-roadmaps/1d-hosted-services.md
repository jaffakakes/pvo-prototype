# 1D: owned services, releases and saved data

[Numbered roadmap](01-first-working-component.md#1d-run-the-finished-service-and-manage-its-data) · [Current progress](../restyle-cloud-agent-progress.md) · [Service contract](../../../packages/pvo-assistant/services/README.md)

## In plain language

The temporary computer builds the program. A separate service keeps its checked program and saved records. Each service belongs to one creator and project and has a stable identity. A release is one exact checked version of that program. New versions start inactive so testing cannot change live records or affect viewers.

The platform decides who may call each action, checks its data, runs the program without account secrets or direct network access, and saves an accepted state change atomically. Repeating an action returns its saved answer. Two people competing for the last place cannot both take it. The creator can inspect, activate, pause or delete a service. Replacing code preserves live records and the previous working release.

## Current checkpoint and ownership

All of 1C is verified. Implementation starts with **1D.01/1D.02**, still unchecked. The active hosting checkout starts from current dev `4bc9f9e` and combines the verified validation prerequisite `f7dac2c` (source `98dd960`, draft #96). No new hosting code or paid calls are claimed by this planning checkpoint.

Keep shared service/release rules in `packages/pvo-assistant/services/` and `releases/`, SQL/runtime adapters in `server/cloud-services/`, and task admission/receipts in the existing focused task modules. The owner-scoped task coordinator can retain a separate service catalog beyond task retention; generated code cannot access it. The immutable release provider must retain its own artifact bytes independently of the builder/workspace.

The existing 1B inactive release is a diagnostic single-module contract. Evolve that contract and its callers/tests/proof fixtures to the current checked multi-module package. Do not add a second production source format, a legacy fallback or a model-owned publication tool. Preserve the already verified uncertain-effect/cancellation journal semantics. Historical paid evidence is not permission or a reason to rerun the proof.

## First implementation slice: 1D.01/1D.02

1. Define a stable owned service identity and a release identity selected by trusted code. Bind each release to exact agreement/source/package/report digests, runtime, operations and their audience/storage permissions. Verify actual canonical bytes again before publication; only a task-owned passed report can enter hosting.
2. Save bounded owner-scoped service/release metadata and a pending publication intent before a provider effect. Exact duplicate identities replay; changed ownership/content conflicts. Source/report retention is independent of the build computer. Keep per-owner service/release counts explicit and enforced outside generated code.
3. Update the existing release provider to save the checked package inactive. Reuse its stable identity lookup, immutable contents, bounded probes, cancellation tombstone and independent expiry. Record actual provider observation and owned catalog status before advancing the task.
4. A private inactive probe receives only an allowed operation and input. The platform supplies test state and time. Generated code receives no live state, activation switch, credentials or external capabilities. Reuse the isolated package runtime and reply validation; preserve the existing diagnostic budget bounds deliberately when updating fixtures.
5. Connect the trusted `host` stage to the immutable task artifact and provider journal. Missing or failed reports cannot deploy. Recover a lost publication response by looking up the original identity; do not create another service. Stop closes pending inactive identities and blocks late attachment. Advance only to the later attachment stage, never directly to a ready component.

Before marking the two items complete, exercise actual local SQLite/provider/runtime integration, owner/project/content conflicts, failed/missing reports, byte/usage/count bounds, full restart after publication before receipt, inactive probe isolation, Stop before/after dispatch, expiry and cleanup failure. Update declarations, fixtures and documentation in the same batch. Full live cloud/model acceptance remains 1F; prepare a separate bounded plan if changed provider behavior needs new paid evidence.

## Following slices

| Tasks | Required behavior |
| --- | --- |
| 1D.03 | Stable route resolves recorded service/release, verifies owner for private operations, admits only the public operation surface for viewers and validates input before execution. Caller flags cannot select test/live permissions. |
| 1D.04/1D.05 | Separate durable test/live state. Serialize the read/execute/validated-commit operation, fence cancellation/deletion/version changes and journal action IDs. Same ID/input replays; changed input conflicts. Concurrent capacity and overlapping-booking cases use different IDs. |
| 1D.06/1D.07 | Authenticated inspection/activation/pause/delete and explicit external limits. Stop cancels inactive authoring work; active service lifetime is controlled separately. Retain cleanup obligations beyond ordinary task expiry. |
| 1D.08 | Keep the last active release while a new one is checked. A failed replacement cannot displace it. Rollback must validate current stored records against the chosen agreement; it does not rewind data. |

Do not infer production deployment from local test success or beta assets. Use the current release workflow, keep unrelated releases intact, and record implementation/PR/beta/production separately.
