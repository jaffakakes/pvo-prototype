# Restyle maintenance and checked repair

[Roadmap 4](restyle-cloud-agent-roadmaps/04-maintenance-and-expansion.md) · [Architecture](architecture.md) · [Progress](restyle-cloud-agent-progress.md)

## In plain terms

A Container has one saved program, checked versions and its existing records. **Investigate and repair** looks at that same Container. It first tests the saved draft with safe examples, then distinguishes a code problem from account access, inputs or an outside service. A code fix needs a test that catches the original bug and passes with the fix, plus Restyle's independent behavior checks. The result is an unpublished checked version for the creator to review. Existing viewers and records keep using the published version until its creator publishes an update.

An expired account connection gets a reconnection instruction. It does not cause a speculative code rewrite or a second account connection. Passing examples without a reproduction lead to clarification, not a claim that the reported problem was fixed. The account-linked agent email idea is paused by the creator; no address provisioning, email identity, plugin or marketplace is included.

## One existing system

- Pure evidence, diagnostic stages and operational rules: `packages/pvo-assistant/maintenance/`.
- Owned host observation: `server/cloud-services/maintenance.js`, exposed as authenticated `GET /api/services/:serviceId/maintenance`. It uses the existing per-service SQLite owner and private account metadata adapter. It starts no Node instance, invokes no generated operation and makes no provider request.
- Investigation coordination: `server/assistant/maintenance/`, alongside existing draft commands, builder tools, workspace receipts, independent validation and immutable hosting journals. No new runner, source store, deployment authority or credential store.
- Existing Container code/health/investigation controls under `editor/src/features/services/`; network effects under `infrastructure/services/maintenance.ts`.
- No PVO grammar, Node guest/runtime, public attachment, Try, export or player contract change. Earlier actual Fly/provider evidence remains applicable; only affected behavior is rechecked.

## Private observation and diagnosis

The trusted host returns owner/project/service identity, observation time, lifecycle/revision, deployed checked source, release availability, a bounded recorded component dependency inventory, metadata-only account availability/expiry, sanitized failure codes, job status and operational issues. No submitted viewer input, guest records, saved reply bodies, receipt secret, account email/repository scope, credential or provider authorization header is projected to the model. Source remains private to its creator; comments/output are untrusted data.

The UI admits only the small identity/status/issues projection. The agent receives source inventories and reads draft or deployed files in bounded 4 KiB chunks (`read` or `read_published`). Existing draft parsing and model context limits still apply. Deployed source can differ from the saved draft; the safe baseline is explicitly for the frozen draft. Up to eight component references per recorded dependency are shown in the agent inventory; the operational check scans every stored reference, deduplicating faults by release. Missing dependency records are not evidence of zero viewers or zero forwarded copies.

A diagnosis cites existing evidence keys and their actual stage: component input, gateway validation, backend rule, external account, provider, result display or unknown. The host rejects invented keys and stage mismatches. Unknown viewer behavior needs clarification; unsupported UI/provider facts cannot be invented. Account/permission, missing-release, unresolved external action and capacity issues have existing recovery instructions and do not authorize code edits. Historical failed calls remain labelled historical; they are not proof of an ongoing fault.

## Saved repair lifecycle

`context.container.mode` now has one current contract: `edit`, `test` or `repair`. Existing `edit`/`test` behavior stays intact. Repair freezes the exact owned service draft and requires an agreement and selected tests.

1. **Observe:** verify account, project and Container ownership. Capture health; changes to the published version or pause state invalidate the investigation. Its own inactive checked version is allowed.
2. **Baseline:** restore saved source to the existing workshop, run selected tests and independent behavior cases with initial/example data. No live records or external account calls. Save actual failure/pass evidence before inference.
3. **Diagnose:** the model cites observed evidence. Only a reproduced backend failure allows code edits. Read current draft source first; use existing revision-fenced save commands. Preserve all original agreement cases and behavior. Account faults receive a recovery report.
4. **Countercheck:** the extra 4D capability. Restore original implementation files plus proposed selected regression files in the same workshop journal. The selected tests must fail. A test that passes here returns to planning with `not_reproduced`; it cannot produce a checked repair.
5. **Verify:** restore repaired draft bytes, run selected tests again, then all original independent cases. The independent artifact must preserve the original agreement and include a changed regression file. Failed checks return to diagnosis, keeping evidence; generated output cannot declare success.
6. **Save and prepare:** use the existing checked-draft synchronization and inactive hosting receipt on the same `serviceId`. The final report records baseline, countercheck, checked revision, diagnosis and remaining dependencies. It always states `published:false`; activation remains the creator's separate command.

The countercheck proves observed test behavior (original fails, repaired passes). It does not mathematically prove every assertion is meaningful or every possible bug absent; the unchanged independent agreement remains the separate trusted gate. A requested behavior/schema change uses a normal edit task rather than weakening the repair's original independent cases.

Manual edits that win a save conflict are preserved. The creator decides whether to continue from that newer draft, then repair clears old diagnosis/baseline and tests the newer bytes. Stop/claim expiry, lost saves, pending provider/workspace effects and cleanup use existing durable fences and reconciliation. Browser closure does not own the task or service lifetime.

## Health and recovery

Container health derives unresolved status from durable records each time it is opened/refreshed. Collapsing details or dismissing another notice cannot clear the underlying issue. It checks:

- Known expiry and a seven-day advance warning; unavailable/missing permissions and checked-release approval. Unknown expiry is not treated as permanent validity, and this metadata read is not a fresh provider authentication test.
- Unresolved jobs/outside actions: inspect or resume the original identity; never create another request as a repair.
- Existing daily action/execution, saved-result/job and compute allowance/capacity. Daily resets and the original action identity are retained; no model turn cap is added.
- Every recorded component/export reference and current live version against stored release availability. A missing version has an explicit pause/review/reconnect/export instruction. No automatic restoration or silent deletion of old data is claimed.

The timestamp labels the observation; refresh is explicit. Failure to load health shows an accurate retry and retains the previous observed status. Account replacement/unmount aborts reads and fences late results.

## Updates, costs and cleanup

Use the existing 1G activate/pause/delete/update/rollback commands. Pending background jobs or uncertain outside writes prevent switching versions/deleting until resolved or safely cancelled. Returning to an earlier code version preserves data and original action/provider receipts; it cannot resend a completed action or rewind records. Account approval remains tied to the exact checked release. Code diagnosis does not renew credentials, grant spending or publish a service.

Health reads create no hosted Node compute. Investigations use existing account-scoped model/workshop permissions, reservations, capacity, lifetime and cleanup. Counterchecking adds one saved test phase; retries follow existing durable receipts and unknown-effect reconciliation. Draft/source working copies, original baseline, bounded command output and test reports share task retention; unresolved cleanup is retained until reconciled. Active services and creator drafts retain their existing independent lifetime. No permanently running extra monitor or VM is introduced.

## Reproducing verification

From the focused branch, install dependencies and build language WASM if absent. Run:

```sh
node --test tests/service-maintenance/*.test.mjs tests/service-drafts/*.test.mjs tests/service-jobs/hosting.test.mjs
npm run check
npm run check:editor
```

For real editor/browser integration, start the source editor on a loopback port, then:

```sh
EDITOR_URL=http://127.0.0.1:5327/ node scripts/checks/editor/container-maintenance.mjs
EDITOR_URL=http://127.0.0.1:5327/ node scripts/checks/editor/container-connections.mjs
node scripts/checks/player/background-jobs.mjs
```

The diagnostics use disposable local SQLite and actual native Node/Chromium execution. Model decisions, provider responses and workshop provisioning are controlled; selected regression commands and independent service execution actually run. No live message, provider account access, model inference, new paid hosting, production deployment or new live-model quality claim follows from these tests. Preserve completed earlier live proofs instead of rerunning them merely because private logs are missing.

Beta build, served revision, fresh activated service worker, backups, cleanup and final task checkboxes are recorded separately in [progress](restyle-cloud-agent-progress.md).

## Verified acceptance — 8 October 2026

All eleven remaining Roadmap 4 tasks are verified; all **134/134** roadmap checkboxes are complete. Source `66681bce4acec16e3357bd1c2a52f4fd07ef0e5b` plus the completion evidence commit is on `origin/codex/restyle-maintenance`, draft [PR #109](https://github.com/jaffakakes/pvo-prototype/pull/109), open/unmerged. Fetch that branch on another computer and use the commands above; local private logs are optional. Preserve earlier real Fly/GitHub/Resend proof rather than repeating paid tests to recreate receipts.

| Area | Observed result |
| --- | --- |
| Baseline and repair | Actual native Node selected tests pass original baseline, fail original implementation with proposed regression, then pass repaired implementation: exits **0,1,0**. Separate original independent cases pass the repair. Invalid independent changes and a regression that also passes the original are rejected before a checked release. |
| Account fault | Disconnected account gives a reconnection report with no speculative code edit, new connection or provider call. |
| Existing state | Same service/draft identity; saved records and replies survive repair, checked publication, server restart and rollback. Unresolved jobs block update; completed original action replay after update/rollback executes once and does not rewind records. |
| Manual conflict | Newer creator bytes remain intact; a saved continue answer forces a fresh baseline and diagnosis for the newer draft. |
| Health | Other owners denied; no submitted data/secrets projected; known expiry/permissions, daily/saved/compute limits, unresolved work and all current/recorded missing releases retain accurate recovery after restart. Failed refresh retains earlier status; retry/owner replacement passes. |
| Creator browser | Actual desktop/phone repair control, saved report, restart, health failure/retry and owner change; no horizontal overflow. Two visual rounds complete and manual design detector empty. |
| Component/viewer | Real compiler/isolated iframe Try, lost reply and exact replay, normal downloaded PVO, public cross-origin viewers, background IndexedDB intent, closed-viewer restart, private receipt and wrong-key denial. No live provider message is sent in these diagnostics. |
| Checks | Full `npm run check`: **1,695 tests**, **1,038 syntax / 1,025 dependency / 787 adopted-formatting files**; strict editor types. Final six repair cases include two added guard tests after the full run. No later application source change. Combined-beta build/types/**43 focused checks** also pass. |
| Beta | Combined commit `5063d9740122925f15eed24d7680235b291e2d8c` includes previous beta `fcdb0bc` and new source. Actual Desktop `dist/` at4173 serves **`restyle-editor-shell-7bbb710096de4c50`**. Exact editor/player/receipt/maintenance modules, new UI text and a fresh activated service worker pass. |

Delivery preserved before/built output at `~/.codex/backups/restyle-4-beta-ve10rsro`, copied assets before HTML/SW, retained **143** old hashed assets and did not reload the creator's session. Existing large-chunk build warning remains. Owned source preview5327 is stopped, native workshop temp directories are absent, and disposable fixtures/Chromium close in `finally`. No cloud resource, live message or connection key was created. Cleanup receipt: `~/.codex/backups/restyle-4-cleanup.json`. App archival rejected the isolated managed beta worktree as protected by a pinned task/workspace, so it is retained intact; its owned dependency symlink is removed and needed built output is backed up.

These are actual local execution/browser results with controlled model decisions, provider responses and workshop provisioning. They do not establish live-model quality or fresh provider authorization. The static beta has no permanently configured task/account/service APIs; permanent backend availability is separate deployment work. Agent email stays paused. Integration merges, GitHub Actions work, production deployment and unreleased-branch deletion remain unauthorized. No numbered implementation task remains; await user beta review and a separately chosen deployment or future capability task.
