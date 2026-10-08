# Restyle beta backend connection

[Current progress](restyle-cloud-agent-progress.md) · [Handoff](restyle-cloud-agent-handoff.md) · [Environments](environments.md)

## Authorized scope — 8 October 2026

The creator requested connecting the existing beta to an ongoing backend and explicitly prohibited production. Agent email remains paused. Roadmaps 1–4 retain all 134 completed implementation checkboxes; these deployment tasks are separate.

In plain terms: give the beta app its own online memory and engine. Keep saved tasks, source, releases and records after the browser closes. Start development workshops and Fly Node execution only when needed. Keep beta accounts, media and ownership separate from production. Existing per-call, daily capacity, storage, execution and cleanup controls still apply; no new goal-wide model-turn limit is introduced.

## Deployment checklist

- [x] **BETA.01** Prepare an isolated beta configuration, resource inventory and recoverable handoff; verify no production route, database, bucket or namespace is selected.
- [x] **BETA.02** Provision beta account/media storage and the existing Worker/SQLite/workshop bindings; use independent secrets and development sign-in.
- [ ] **BETA.03** Connect the existing inference provider and dedicated Fly Node runtime, verify the immutable image, create only scoped persistent execution credentials and remove temporary build resources.
- [ ] **BETA.04** Serve the existing checked beta app with the backend on one HTTPS origin; verify real sign-in, owner-scoped tasks/Containers, save/reload and authorized execution without production access.
- [ ] **BETA.05** Verify browser and service operation/recovery, record retained resources, cost controls and cleanup; save the GitHub and portable handoff with the exact beta URL.

## Planned ownership

| Resource | Beta target | Lifetime |
| --- | --- | --- |
| App and HTTP backend | Worker `restyle-beta`, separate workers.dev HTTPS origin | Retained for beta use |
| Accounts and sessions | D1 `restyle-beta-accounts` | Retained; initial schemas applied only here |
| Private media | R2 `restyle-beta-media` | Retained; no production bucket reuse |
| Tasks, releases, data, jobs, budgets | New namespaces belonging to the beta Worker | Retained; existing task/service retention applies |
| Temporary development workshop | Container application `restyle-beta-workspaces` | Configuration retained; instances shut down through existing journals/watchdogs |
| Hosted Node execution | Dedicated Fly app `restyle-beta-node`, immutable checked runtime | App/image retained; short invocation Machines destroyed after execution |
| Sign-in | Existing Clerk development instance; beta-owned account rows and session secret | Retained; no production account/session copy |
| AI inference | Existing Runpod hosted model connection | Secret in beta Worker only; existing capacity admission |

Private deployment intent journal: `~/.codex/secure/restyle-beta-backend/journal.json`. It records resource intent before creation and outcomes afterward. Secrets remain outside tracked source and reports. The existing local beta output and editing session are preserved. No integration merge, Actions work, production release or unreleased-branch deletion.

## Continuation

Active branch `codex/restyle-beta-backend` starts at fetched `origin/dev` (`cc2193e`), explicitly fast-forwards completed implementation `eb8226b`, and includes the already verified combined beta `5063d97` at `c27c861`. This keeps the existing app and backend prerequisites together without changing an integration branch. The active source checkout is `/Users/christinasmacbook/.codex/worktrees/restyle-research-connections/pvo-prototype`.

Source/configuration `dbf4e5b` is committed/pushed on the focused branch. [Draft PR #110](https://github.com/jaffakakes/pvo-prototype/pull/110) is attached, open and unmerged. Keep this draft pending the remaining deployment checks.

Current next task: **BETA.03**, waiting for the human's fresh Fly CLI approval. **BETA.04** also needs real creator sign-in at the beta URL, or clarification that their existing account uses Google only. Keep `ASSISTANT_TASK_SPENDING` empty until the actual owner is known. No Fly app/Machine/credential or owner grant exists yet, so full Container execution and connected-beta completion remain unverified.

## Verified deployment — 8 October 2026

- **Deployed:** https://restyle-beta.jaffakakes28.workers.dev/editor/ ; Worker `restyle-beta`, version `185dd285-48a4-4f14-a855-b51f639386e5`; beta D1 `d5b55822-674a-4f9a-8019-ee10dfa3764e`, all five initial schemas; private R2 bucket; eight Worker-owned SQLite namespaces; `restyle-beta-workspaces` application. These are ongoing beta resources, intentionally retained. No workshop instance has been started in this deployment task.
- **Isolation:** guarded dry run and five focused deployment/Fly credential checks pass. Anonymous sign-in/status reads return 200; task/service/account-connection reads return 401. Production storage bindings are reread and unchanged. Independent stable beta secrets are private; existing local beta4173/session is preserved.
- **AI:** existing Runpod connection accepts hosted-model inventory and **one actual native assistant HTTP request** through the deployed beta, with validated output. The control-plane endpoint returns 403; broader provider access is not claimed. The request creates no Container or external message.
- **Source:** `npm run check` **1,699/1,699**, **1,043 syntax / 1,026 dependency / 793 adopted-formatting files**. The first run's sole style-gap failure was stale generated WASM predating the included combined-beta source. Backup `~/.codex/backups/restyle-beta-compiler-before`; rebuilding unchanged Rust source fixes the focused compiler check, then final full verification passes. Initial Worker `546fe942-bf72-4586-9a4a-088b4e4f4535` is superseded by the corrected version above.
- **Browser:** exact served editor/player/receipt/shared modules and new UI bundle match the verified Roadmap 4 build. Actual desktop/phone email sign-in UI and fresh **activated** service worker pass at `restyle-editor-shell-7bbb710096de4c50`. This proves served assets/auth UI, not completed user sign-in or owned Container execution.
- **Cleanup:** browser fixtures close in `finally`. No Fly builder, Machine or temporary registry credential exists yet. Retain the successful beta deployment/storage, protected combined-beta worktree and existing local beta server. Private journals record intent and outcomes; never commit credentials. Actual ongoing costs depend on use, with existing capacity/storage/watchdog controls; no invoice total is claimed.

All 484 local links/anchors across 33 related documents pass; all 134 prior task IDs/descriptions/completion states are unchanged. The five separate BETA tasks record actual deployment progress.

Logs on this Mac: `/tmp/restyle-beta-check-final.log`, `/tmp/restyle-beta-deployment-tests.log`, `/tmp/restyle-beta-language.log`, `/tmp/restyle-beta-compiler-regression.log`, `/tmp/restyle-beta-guarded-dry-run.log`, `/tmp/restyle-beta-model-preflight.log`, `/tmp/restyle-beta-served.log`. On another machine, committed resource identifiers, commands and these bounded evidence claims are sufficient for continuation; do not repeat live inference merely to replace a missing log.

Cloudflare environments isolate deployment bindings and secrets; the dedicated configuration here makes beta target selection explicit. See [Cloudflare environments](https://developers.cloudflare.com/workers/wrangler/environments/), [Container configuration](https://developers.cloudflare.com/containers/reference/wrangler-configuration/) and [Fly scoped credentials](https://docs.fly.io/security/tokens).

## Operator commands

The tracked configuration has no secrets. Stage the verified beta build into `.wrangler/beta/assets` (preserve existing output and old assets before any future update). Store beta-only `SESSION_SECRET`, `ACCOUNT_CONNECTION_KEY`, `RELEASE_NOTIFY_TOKEN` and `RUNPOD_API_KEY` in a private JSON file. The control backend can deploy before Fly is connected; full Container execution additionally requires the app-scoped `SERVICE_NODE_FLY_TOKEN`. Until that final connection and real execution pass, BETA.03–05 stay unchecked. The default is `~/.codex/secure/restyle-beta-backend/worker-secrets.json`; another machine can set `RESTYLE_BETA_SECRETS_FILE` to its own private file. Never copy a production session/encryption secret. Run:

```sh
npm run deploy:beta:built -- --dry-run
npm run deploy:beta:built
```

The same trusted Node image builder now admits the explicit beta app name as well as the existing disposable proof namespace. This changes no guest source, runtime image digest, execution privilege or independent test boundary. A prepared Worker configuration is not proof of a successful live request. After deployment, verify real sign-in, the current owner, saved task/draft recovery, independent checks and service execution, and confirm temporary Machines are gone.
