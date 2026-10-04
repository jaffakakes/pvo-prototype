# Branch cleanup — 4 October 2026

## Follow-up cleanup and release queue

On the follow-up review, removed four more local branches: `codex/release-readiness`, `codex/stacked-timeline-layers`, `codex/splash-screen-production` and `codex/try-debugger`. The last three also had remote branches, which were removed. Their commits were already in the successfully deployed production release; their pending files were generated output or a dependency symlink, not unreleased source changes.

The four worktrees remain at their original commits, detached, with pending files preserved. Backups, tracked patches, exact refs and content hashes are in `.git/audit-backups/branch-cleanup-followup-2026-10-04T181405Z/`. Verification confirmed all removed refs were absent and preserved files still matched their hashes. No application files or running servers were changed by cleanup.

Across both passes, **23 local and 20 remote branch references were removed**. A new theme branch was created by an active task between passes. At the follow-up check, **9 local and 5 remote feature branches remained**; these counts exclude integration/history branches.

The actual app release queue at the follow-up inspection is:

| Work | Branch | Status |
| --- | --- | --- |
| Editor appearance themes | `codex/editor-theme-production` | Merged into `dev` by [PR #63](https://github.com/jaffakakes/pvo-prototype/pull/63) and `preprod` by [PR #64](https://github.com/jaffakakes/pvo-prototype/pull/64); production promotion [PR #65](https://github.com/jaffakakes/pvo-prototype/pull/65) is open. Another active task owns this release. |
| Clerk email/password sign-in | `codex/email-password-auth` | [PR #62](https://github.com/jaffakakes/pvo-prototype/pull/62) remains open into `dev`; three branch commits are not in production. |
| Current uncommitted development | `codex/orb-conversation-thread` and active working copies | Pending files require reconciliation into focused changes. The orb branch's three committed feature intentions have already shipped through replacement commits; its name is not an accurate inventory of its current uncommitted work. |

The main pending working-tree groups are export dialog/cover/quality work, server rendering and its queue, Collect replies and the creator inbox, the Restyle player layout, and account/camera improvements. These are mixed with copies of released code and active theme changes. They are not separate ready-to-deploy branches, and comparing branch tips alone misses them. Some launch-splash and Google server-auth files match production exactly despite appearing dirty or untracked against this checkout's older base.

Other retained names are **not additional app features queued for production**:

- `codex/public-quiz-leaderboard` and `codex/public-quiz-leaderboard-clean` contain the same patch. This is a local-only quiz test service whose own README explicitly says not to deploy it. Keep its deployment restriction; the duplicate names can be reconciled separately.
- Remote `codex/package-public-pvo-modules` contains unmerged npm package metadata and tarballs, with no PR. It is package-publication work, not a website release.
- `codex/restyle-assistant-thread-archive` is an obsolete implementation for the earlier assistant contract. Its patch is already duplicated in the orb branch; production has the replacement conversation thread from PRs #42–44. It was retained as an archive, not marked as a release candidate.
- `codex/native-editor-assistant-split-source` contains functionally released assistant work. A live preview server still uses its checkout; residual deployment integration/documentation differences are not a new assistant feature.
- `codex/fonts-voice-errors` has a released committed tip, a running preview/iMessage bridge and unresolved source changes.
- `codex/request-error-feedback` has a released committed tip and pending source/generated changes, so its checkout still needs reconciliation.

The root [AGENTS.md](../../AGENTS.md) now requires completed task branches to be removed locally and remotely after a verified successful production release, with current-tip checks, active-work protection and a recovery record. This is part of completing an authorized release and does not require a separate routine cleanup confirmation.

## Initial cleanup record

Completed after the [organization audit](organization-audit-2026-10-04.md): removed **19 local feature branches and 17 remote feature branches** whose exact tips were proven ancestors of the successfully deployed production commit.

Local feature branches decreased from 31 to 12. Remote feature branches decreased from 24 to 7 after refreshing remote references. Including retained integration/release/history branches, 15 local branches and 12 remote branches remain. Local and remote removals overlap; they are not 36 distinct features.

## Release evidence and safeguards

- Deployed `origin/prod`: `079c37568317e0f1bb0e0d14d79cf47e2ef8099e`.
- [Successful production workflow](https://github.com/jaffakakes/pvo-prototype/actions/runs/37211965247), including its Cloudflare deploy step.
- [Live editor release](https://getrestyle.app/editor/release.json) matched the workflow's announced revision: `restyle-editor-shell-d11b979252cc48bb` at inspection time.
- Every removed tip passed Git ancestry verification against that deployed commit. Open pull requests, registered worktrees, their pending changes, active Codex tasks and running processes were checked.
- Before removal, saved exact branch names, tips, worktree locations and all refs in `.git/audit-backups/branch-cleanup-2026-10-04T171401Z/`. `recovery-manifest.json` identifies every removed reference; `results.json` records operations; `verification.json` records the final branch state. The commits remain reachable through production history, so local names can be restored with `git branch <name> <recorded-sha>`.
- Nine clean, inactive worktrees were detached at their existing commits so their branch names could be removed. Their files and directories were retained; their unchanged commits and clean state were verified afterward. No dirty worktree was detached or removed.
- Remote removal was one atomic push with an explicit expected-SHA lease for each branch. A changed remote tip would have rejected the operation.
- The active checkout remained on `codex/orb-conversation-thread`. Production and integration refs were not changed. No app build, deploy, reload or process termination was performed.

## Removed branches

All names below have the `codex/` prefix.

| Branch suffix | Local removed | Remote removed |
| --- | --- | --- |
| animated-template-gallery | Yes | Yes |
| animated-template-previews | Yes | No remote existed |
| cloudflare-managed-domain | Yes | Yes |
| component-code-focus | Yes | Yes |
| create-recovery-unblock | Yes | Yes |
| default-component-drag | Yes | Yes |
| fix-try-pause-playback | Yes | Yes |
| google-oauth-worker-redirect | Yes | Already absent when fetched |
| google-sign-in | Yes | Yes |
| imessage-public-privacy | Yes | Yes |
| keyframe-playback-production | Yes | Yes |
| layer-position-inputs | Yes | Yes |
| native-editor-assistant | Yes | Yes |
| preview-view-switch-playback | Yes | Yes |
| remove-safe-zone-guides | Yes | Yes |
| response-policy | Yes | Yes |
| restyle-thread-production | Yes | Yes |
| timeline-playback-sync | Yes | Yes |
| timeline-playhead-snap | Yes | Yes |

## Work retained after the initial pass

All feature names below also have the `codex/` prefix. Dirty status counts are observations from the inventory, not permanent facts.

| Branch suffix | Reason retained |
| --- | --- |
| orb-conversation-thread | Current checkout, two active tasks, extensive pending source and generated changes. |
| email-password-auth | [Open PR #62](https://github.com/jaffakakes/pvo-prototype/pull/62), three commits not ancestors of deployed production, and pending generated output. |
| native-editor-assistant-split-source | Live development server; 30 non-ancestor commits, of which 29 were patch-equivalent and one still differed. Patch equivalence alone was not used as deletion authority. |
| fonts-voice-errors | Live development server and iMessage bridge, plus pending source/documentation changes. Its committed tip is deployed, but the worktree is not disposable. |
| public-quiz-leaderboard | One commit not proven included in production. |
| public-quiz-leaderboard-clean | One commit not proven included in production; local and remote retained. |
| restyle-assistant-thread-archive | One commit not proven included in production; local and remote retained. |
| package-public-pvo-modules | Remote-only branch with one commit not proven included in production. |
| release-readiness | Deployed tip, but its worktree contains an untracked `node_modules` entry. |
| request-error-feedback | Deployed tip, but its worktree contains pending source and generated changes. |
| splash-screen-production | Deployed tip, but its worktree contains pending generated output; local and remote retained. |
| stacked-timeline-layers | Deployed tip, but its worktree contains pending generated output; local and remote retained. |
| try-debugger | Deployed tip, but its worktree contains pending generated output; local and remote retained. |

`dev`, `preprod` and `prod` retain their [promotion responsibilities](environments.md). Existing `main` and remote `editor` history references were left in place. The cleanup did not fast-forward stale local integration branches or alter their checkouts.

This initial inventory classified active work, pending files, an open PR, unproven release inclusion, and integration/history. The follow-up above refines that classification and removes four of these names. Further cleanup should first reconcile pending work and unique commits, then apply the same production-ancestry check. Branch age and a merged-looking name are insufficient evidence.
